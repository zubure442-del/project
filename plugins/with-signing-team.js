/**
 * Возвращает команду подписи в проект Xcode после каждого `expo prebuild`.
 * Без этого выбранная вручную Team пропадает при пересоздании папки ios/,
 * и сборку на телефон приходится каждый раз настраивать заново.
 * Идентификатор берётся из app.json: expo.ios.appleTeamId.
 */
const { withXcodeProject } = require('expo/config-plugins');

module.exports = function withSigningTeam(config) {
  return withXcodeProject(config, (c) => {
    const team = c.ios?.appleTeamId;
    if (!team) return c;
    const project = c.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const settings = configurations[key]?.buildSettings;
      if (!settings || !settings.PRODUCT_BUNDLE_IDENTIFIER) continue;
      settings.DEVELOPMENT_TEAM = team;
      settings.CODE_SIGN_STYLE = 'Automatic';
    }
    const targets = project.pbxNativeTargetSection();
    for (const key of Object.keys(targets)) {
      if (typeof targets[key] === 'string') continue;
      project.addTargetAttribute('DevelopmentTeam', team, targets[key]);
    }
    return c;
  });
};
