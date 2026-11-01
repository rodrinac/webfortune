{
  description = "webfortune development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, rust-overlay, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              overlays = [ rust-overlay.overlays.default ];
            }
          )
        );

      # Same Debian bookworm packages used to generate Worker assets, so local
      # and production fortune/cow data stay aligned on every platform.
      # Workers Builds reads this file too; it has no Nix.
      debianPackages = builtins.fromJSON (
        builtins.readFile ./scripts/debian-fortune-packages.json
      );

      mkFortuneData =
        pkgs:
        let
          perl = pkgs.perl.withPackages (perlPackages: [ perlPackages.TextCharWidth ]);
          debs = map (
            package:
            pkgs.fetchurl {
              urls = [
                "https://deb.debian.org/debian/pool/main/${package.path}"
                "https://snapshot.debian.org/archive/debian/20251001T000000Z/pool/main/${package.path}"
              ];
              inherit (package) hash;
            }
          ) debianPackages;
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "webfortune-debian-data";
          version = "bookworm";
          srcs = debs;
          dontUnpack = true;
          nativeBuildInputs = [
            pkgs.libarchive
            pkgs.makeWrapper
          ];
          buildInputs = [ perl ];

          installPhase = ''
            runHook preInstall

            mkdir -p root
            for deb in $srcs; do
              mkdir -p ar
              bsdtar -xf "$deb" -C ar
              tar -xf ar/data.tar.* -C root
              if [ -f ar/control.tar.* ] && bsdtar -tf ar/control.tar.* ./postinst ./templates >/dev/null 2>&1; then
                mkdir -p control
                tar -xf ar/control.tar.* -C control ./postinst ./templates
              fi
              rm -rf ar
            done

            mkdir -p $out/share $out/libexec
            cp -R root/usr/share/games $out/share/games
            cp -R root/usr/share/cowsay $out/share/cowsay
            cp root/usr/games/cowsay $out/libexec/cowsay

            # fortunes-de only enables the categories selected through debconf,
            # by linking their .dat indexes in postinst. Run the real postinst
            # with the template default, as a noninteractive apt install does.
            default=$(awk '
              /^Template: fortunes-de\/fortunes_to_install$/ { found = 1 }
              found && /^Default: / { sub(/^Default: /, ""); print; exit }
            ' control/templates)
            test -n "$default"
            printf 'db_version() { :; }\ndb_get() { RET=%q; }\n' "$default" > confmodule
            sed -e "s|/usr/share/debconf/confmodule|$PWD/confmodule|" \
              -e "s|/usr/share/games/|$out/share/games/|g" \
              control/postinst > postinst
            bash postinst configure

            patchShebangs --host $out/libexec/cowsay
            makeWrapper $out/libexec/cowsay $out/bin/cowsay \
              --set-default COWPATH $out/share/cowsay/cows

            runHook postInstall
          '';
        };
    in
    {
      packages = forAllSystems (pkgs: rec {
        fortune-data = mkFortuneData pkgs;
        default = fortune-data;
      });

      devShells = forAllSystems (
        pkgs:
        let
          fortuneData = mkFortuneData pkgs;
          rustToolchain = pkgs.rust-bin.stable.latest.minimal.override {
            extensions = [
              "clippy"
              "rust-src"
              "rustfmt"
            ];
            targets = [ "wasm32-unknown-unknown" ];
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              rustToolchain
              pkgs.worker-build
              pkgs.nodejs_24
              fortuneData
            ];

            FORTUNE_DATA_DIR = "${fortuneData}/share/games/fortunes";
            COWPATH = "${fortuneData}/share/cowsay/cows";
          };
        }
      );
    };
}
