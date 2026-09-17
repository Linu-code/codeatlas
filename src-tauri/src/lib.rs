//! CodeAtlas Rust 核心 —— 刻意保持极薄：只做前端做不到的三件事。
//!
//! 命令清单：
//!   read_file_base64(path)            —— 读文件字节（拖入 ZIP 时 Tauri 只给路径）
//!   open_zip_window(label, path)      —— 为 ZIP 开独立窗口（多窗口，互不干扰）
//!   load_config() / save_config(json) —— 读写 ~/.codeatlas/config.json
//!
//! 分析逻辑一律不在这里（全部在前端 TypeScript 纯函数层，便于单测与浏览器复用）。

use std::fs;
use std::path::PathBuf;

use base64::Engine;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 读文件并返回 base64（避免大文件经 JSON 数组逐字节传输的开销）
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("read failed: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// 为 ZIP 文件开一个独立窗口：原窗口状态完全不受影响（验收标准 8）
#[tauri::command]
async fn open_zip_window(
    app: tauri::AppHandle,
    label: String,
    zip_path: String,
    title: String,
) -> Result<(), String> {
    // 新窗口通过 URL 参数告知自己要加载哪个 ZIP，窗口之间零共享
    let url = format!(
        "index.html?win={}&zippath={}",
        urlencoding(&label),
        urlencoding(&zip_path)
    );

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(PathBuf::from(url)))
        .title(title)
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .build()
        .map_err(|e| format!("create window failed: {e}"))?;

    Ok(())
}

/// 关闭当前窗口（新窗口内提供"关闭"入口时使用）
#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(|e| format!("close failed: {e}"))
}

/// 配置文件路径：~/.codeatlas/config.json（跨平台取家目录）
fn config_path() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "cannot resolve home directory".to_string())?;
    Ok(PathBuf::from(home).join(".codeatlas").join("config.json"))
}

#[tauri::command]
fn load_config() -> Result<Option<String>, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("read config failed: {e}"))
}

#[tauri::command]
fn save_config(json: String) -> Result<(), String> {
    let path = config_path()?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("create config dir failed: {e}"))?;
    }
    fs::write(&path, json).map_err(|e| format!("write config failed: {e}"))
}

/// 最小 URL 编码（只编码会破坏 query 的字符，避免引入额外依赖）
fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' | '/' | ':' => c.to_string(),
            _ => format!("%{:02X}", c as u32 & 0xFF),
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 首次启动确保主窗口存在（tauri.conf.json 已声明，这里只做兜底）
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file_base64,
            open_zip_window,
            close_window,
            load_config,
            save_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running codeatlas");
}
