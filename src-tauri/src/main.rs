// 桌面版入口：Windows 下隐藏控制台窗口，逻辑全部在 lib.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    codeatlas_lib::run()
}
