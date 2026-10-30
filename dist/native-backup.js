(() => {
  "use strict";

  const capacitor = window.Capacitor;
  const isAndroidApp = () => Boolean(
    capacitor &&
    typeof capacitor.getPlatform === "function" &&
    capacitor.getPlatform() === "android" &&
    typeof capacitor.registerPlugin === "function"
  );

  async function saveFile(filename, contents) {
    if (!isAndroidApp()) throw new Error("没有检测到安卓版文件保存功能，请使用网页版导出。");
    if (!capacitor.isPluginAvailable("BackupExport")) {
      throw new Error("安卓文件保存组件未就绪，请安装最新版 APK 后重试。");
    }

    const backupExport = capacitor.registerPlugin("BackupExport");
    const result = await backupExport.saveFile({ filename: filename, contents: contents });
    if (!result || !result.saved) throw new Error("系统没有确认文件写入完成。");
    return result;
  }

  window.ShiguangBackupTransport = { isAndroidApp, saveFile };
})();
