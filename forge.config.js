module.exports = {
  packagerConfig: {
    icon: "src/assets/images/logo-icon.ico"
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: "compareMS2",
        // FIXME: Update install animation
        loadingGif: "node_modules/electron-winstaller/resources/install-spinner.gif",
        setupIcon: "src/assets/images/logo-icon-install.ico"
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          maintainer: 'Rob Marissen',
          homepage: 'https://github.com/524D/compareMS2',
          icon: 'src/assets/images/logo-icon.ico'
        }
      },
    },
  ],
};
