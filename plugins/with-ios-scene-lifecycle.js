/**
 * iOS 27 требует «сценарный» жизненный цикл: приложение падает при запуске, если его не использует.
 * Шаблон Expo SDK 57 всё ещё создаёт окно по-старому, в AppDelegate. Нужный класс в Expo уже есть
 * (ExpoAppSceneDelegate), его достаточно подключить. Этот плагин делает это при каждом prebuild.
 * Когда Expo починит шаблон сам, плагин можно будет удалить.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
      },
    ],
  },
};

const OLD_CLASS = 'class AppDelegate: ExpoAppDelegate {';
const NEW_CLASS = 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';
/** Окно и запуск React Native переезжают в ExpoAppSceneDelegate. */
const WINDOW_BLOCK = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow[\s\S]*?#endif\n/;

module.exports = function withIosSceneLifecycle(config) {
  const withPlist = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return c;
  });
  return withAppDelegate(withPlist, (c) => {
    let src = c.modResults.contents;
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      if (!src.includes(OLD_CLASS)) {
        throw new Error(
          'with-ios-scene-lifecycle: шаблон AppDelegate изменился, объявление класса не найдено. ' +
            'Проверьте, не починил ли Expo сценарный жизненный цикл сам.',
        );
      }
      src = src.replace(OLD_CLASS, NEW_CLASS);
    }
    if (WINDOW_BLOCK.test(src)) {
      src = src.replace(WINDOW_BLOCK, '\n    // Окно создаёт ExpoAppSceneDelegate при подключении сцены.\n');
    }
    c.modResults.contents = src;
    return c;
  });
};
