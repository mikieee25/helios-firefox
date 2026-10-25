module.exports = {
  ignoreFiles: [
    "src",
    "src/**",
    "tests",
    "tests/**",
    "scripts",
    "scripts/**",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "web-ext.config.cjs",
    ".gitignore",
  ],
  run: {
    firefox: "C:\\Program Files\\Zen Browser\\zen.exe",
    firefoxProfile: "C:\\Users\\mklgr\\.helios-zen-test-profile",
    profileCreateIfMissing: true,
    keepProfileChanges: true,
  },
};
