// 防止在 release 模式下额外弹出命令行窗口（仅 Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    graph_and_table_lib::run()
}
