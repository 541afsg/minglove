package com.shiguangbiji.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "BackupExport")
public class BackupExportPlugin extends Plugin {

    @PluginMethod
    public void saveFile(PluginCall call) {
        String filename = call.getString("filename");
        String contents = call.getString("contents");
        if (filename == null || filename.trim().isEmpty() || contents == null || contents.isEmpty()) {
            call.reject("备份内容不完整。", "INVALID_BACKUP");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "saveFileResult");
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("保存已取消。", "SAVE_CANCELLED");
            return;
        }

        Uri uri = result.getData().getData();
        String contents = call.getString("contents");
        if (uri == null || contents == null || contents.isEmpty()) {
            call.reject("没有取得保存位置或备份内容。", "SAVE_FAILED");
            return;
        }

        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IOException("无法打开所选保存位置。");
            output.write(contents.getBytes(StandardCharsets.UTF_8));
            output.flush();
        } catch (IOException exception) {
            call.reject("写入备份文件失败。", "SAVE_FAILED", exception);
            return;
        }

        JSObject response = new JSObject();
        response.put("saved", true);
        response.put("uri", uri.toString());
        response.put("filename", call.getString("filename"));
        call.resolve(response);
    }
}
