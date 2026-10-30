(() => {
  "use strict";

  const getCapacitor = () => window.Capacitor;
  const isAndroidApp = () => {
    const capacitor = getCapacitor();
    try {
      if (capacitor && typeof capacitor.getPlatform === "function" && capacitor.getPlatform() === "android") return true;
    } catch (_) {}
    const localAppHost = window.location.protocol === "capacitor:" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
    return localAppHost && /Android/i.test(navigator.userAgent || "");
  };

  async function saveFile(filename, contents) {
    if (!isAndroidApp()) throw new Error("没有检测到安卓版文件保存功能，请使用网页版导出。");
    const capacitor = getCapacitor();
    if (!capacitor || typeof capacitor.registerPlugin !== "function") {
      throw new Error("安卓版原生桥接尚未就绪，请关闭后重新打开拾光笔记再试。");
    }
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
