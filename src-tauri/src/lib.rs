//! CodeAtlas Rust 核心 —— 刻意保持极薄：只做前端做不到的事。
//!
//! 命令清单：
//!   read_file_base64(path)            —— 读文件字节（拖入 ZIP 时 Tauri 只给路径）
//!   read_text_file(path)              —— 直接读 UTF-8 文本（N5①）
//!   read_dir(path)                    —— 递归列目录（N5①）
//!   select_dir()                      —— 原生目录选择对话框（N5①）
//!   open_zip_window(label, path)      —— 为 ZIP 开独立窗口（多窗口，互不干扰）
//!   close_window()                    —— 关闭当前窗口
//!   load_config() / save_config(json) —— 读写 ~/.codeatlas/config.json
//!
//! 分析逻辑一律不在这里（全部在前端 TypeScript 纯函数层，便于单测与浏览器复用）。

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 读文件并返回 base64（避免大文件经 JSON 数组逐字节传输的开销）
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("read failed: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

// ---------- N5①：本地目录数据源 ----------

/// 递归列目录的单条结果（与前端 LocalDirEntry 对齐）
#[derive(Serialize)]
struct DirEntryInfo {
    /// 相对 POSIX 路径（'src/core.ts'），由 Rust 侧统一分隔符，前端零处理
    path: String,
    is_dir: bool,
    size: u64,
}

/// 递归遍历的硬上限：防止误选根目录把整盘列爆（与前端 MAX_ANALYSIS_FILES 同一量级）
const MAX_SCAN_ENTRIES: usize = 200_000;
/// 目录深度上限：防御符号链接环与超深目录
const MAX_DEPTH: u32 = 24;

/// 需要跳过的目录名（大小写不敏感）—— 与 ZIP 源一致地剔除噪音与构建产物
const SKIP_DIRS: [&str; 12] = [
    ".git", "node_modules", "dist", "build", "out", "target", ".next", ".nuxt",
    ".venv", "venv", "__pycache__", ".idea",
];

/// 递归列目录：返回相对路径列表（文件 + 目录），跳过噪音目录，防御深度/条目数超限。
/// 目录读取失败（无权限等）只跳过该目录，不中断整体。
#[tauri::command]
fn read_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let root = Path::new(&path);
    let md = fs::metadata(root).map_err(|e| format!("metadata failed: {e}"))?;
    if !md.is_dir() {
        return Err("not a directory".to_string());
    }

    let mut out = Vec::new();
    walk_dir(root, "", &mut out, 0)?;
    Ok(out)
}

/// 深度优先遍历。
/// `rel_prefix` 为当前目录相对根的 POSIX 路径（根目录本身传 ""），由调用方逐层下发，
/// 避免从绝对路径反推相对前缀（碎片文件名 / 挂载点都会让反推出错）。
fn walk_dir(dir: &Path, rel_prefix: &str, out: &mut Vec<DirEntryInfo>, depth: u32) -> Result<(), String> {
    if depth >= MAX_DEPTH {
        return Ok(()); // 超深直接截断，避免符号链接环
    }
    let entries = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(()), // 无权限子目录：跳过
    };

    let mut children: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        if out.len() >= MAX_SCAN_ENTRIES {
            return Ok(()); // 条目数超限：静默截断（剩余部分不参与分析）
        }
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue; // 非 UTF-8 文件名：跳过
        };
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let is_dir = file_type.is_dir();

        // 跳过噪音目录（.git / node_modules / 构建产物……）
        if is_dir && SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(name_str)) {
            continue;
        }

        // 规范化相对路径：统一用 '/'（Windows 的 PathBuf 拼接天然兼容）
        let rel = if rel_prefix.is_empty() {
            name_str.to_string()
        } else {
            format!("{rel_prefix}/{name_str}")
        };

        if is_dir {
            out.push(DirEntryInfo { path: rel, is_dir: true, size: 0 });
            children.push(entry.path());
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(DirEntryInfo { path: rel, is_dir: false, size });
        }
    }

    // 子目录按名排序后逐个进入（稳定顺序：与 buildTree 的"目录在前"一致）
    children.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    for child_path in &children {
        let name = child_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let child_rel = if rel_prefix.is_empty() {
            name.to_string()
        } else {
            format!("{rel_prefix}/{name}")
        };
        walk_dir(child_path, &child_rel, out, depth + 1)?;
    }
    Ok(())
}

/// 直接读 UTF-8 文本（文本文件走这里，免 base64 编解码开销）。
/// 非 UTF-8 / 过大（>64 MB）返回 Err，前端降级为 base64 或跳过。
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    const LIMIT: u64 = 64 * 1024 * 1024;
    let md = fs::metadata(&path).map_err(|e| format!("metadata failed: {e}"))?;
    if md.len() > LIMIT {
        return Err("file too large".to_string());
    }
    fs::read_to_string(&path).map_err(|e| format!("read failed: {e}"))
}

/// 原生目录选择对话框（rfd：Windows 原生 Common Item Dialog）。
/// 用户取消返回 None（前端得到 null）。Tauri v2 默认无 dialog 插件，
/// 用 rfd 直接调用系统对话框，避开 capabilities 权限清单（项目尚未启用）。
#[tauri::command]
fn select_dir() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择项目目录")
        .pick_folder()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
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
            read_text_file,
            read_dir,
            select_dir,
            open_zip_window,
            load_config,
            save_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running codeatlas");
}
