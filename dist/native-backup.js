(() => {
  "use strict";

  const capacitor = window.Capacitor;
  const isAndroidApp = () => Boolean(
    capacitor &&
    typeof capacitor.getPlatform === "function" &&
    capacitor.getPlatform() === "android" &&
    typeof capacitor.registerPlugin === "function"
  );

  async function shareFile(filename, contents) {
    if (!isAndroidApp()) throw new Error("没有检测到安卓版系统分享功能，请使用网页版导出。");
    if (!capacitor.isPluginAvailable("Filesystem") || !capacitor.isPluginAvailable("Share")) {
      throw new Error("系统保存组件未就绪，请安装最新 APK 后重试。");
    }

    const filesystem = capacitor.registerPlugin("Filesystem");
    const share = capacitor.registerPlugin("Share");
    const result = await filesystem.writeFile({
      path: "shiguang-backups/" + filename,
      data: contents,
      directory: "CACHE",
      encoding: "utf8",
      recursive: true,
    });
    if (!result || !result.uri) throw new Error("备份文件未能写入临时目录。");

    await share.share({
      title: "拾光笔记完整备份",
      text: "请选择保存到设备或自己的云盘，并确认保存完成。",
      files: [result.uri],
      dialogTitle: "保存拾光笔记备份",
    });
  }

  window.ShiguangBackupTransport = { isAndroidApp, shareFile };
})();
