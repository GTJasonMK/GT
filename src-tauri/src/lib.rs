// 防止在 release 模式下额外弹出命令行窗口（仅 Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
fn save_graph_data(data: String) -> Result<String, String> {
    let app_dir = dirs_next::data_dir()
        .ok_or("无法获取应用数据目录".to_string())?
        .join("GraphAndTable");

    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("创建目录失败: {}", e))?;

    let file_path = app_dir.join("graph_data.json");
    std::fs::write(&file_path, &data)
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn load_graph_data() -> Result<String, String> {
    let app_dir = dirs_next::data_dir()
        .ok_or("无法获取应用数据目录".to_string())?
        .join("GraphAndTable");

    let file_path = app_dir.join("graph_data.json");

    if !file_path.exists() {
        return Ok(String::from("{}"));
    }

    std::fs::read_to_string(&file_path)
        .map_err(|e| format!("读取文件失败: {}", e))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![save_graph_data, load_graph_data])
        .setup(|app| {
            // 在 Windows 上启用 WebView2 的 pinch zoom
            #[cfg(target_os = "windows")]
            {
                use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
                use windows_core::Interface;

                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        unsafe {
                            let core = webview.controller().CoreWebView2().unwrap();
                            let settings = core.Settings().unwrap();
                            if let Ok(settings5) = settings.cast::<ICoreWebView2Settings5>() {
                                // 启用 WebView2 的 pinch zoom，前端通过 visualViewport 检测缩放变化
                                let _ = settings5.SetIsPinchZoomEnabled(true);
                            }
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
