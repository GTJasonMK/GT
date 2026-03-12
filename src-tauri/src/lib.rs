// 防止在 release 模式下额外弹出命令行窗口（仅 Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};

const MAX_SESSION_COUNT: usize = 10;
const MAX_TASK_COUNT: usize = 12;
const MAX_APPROVAL_COUNT: usize = 12;
const MAX_EVENT_COUNT: usize = 60;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphDataInfo {
    backend: String,
    location: String,
    exists: bool,
    byte_size: u64,
    updated_at: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GraphPosition {
    x: f64,
    y: f64,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GraphNodeRecord {
    id: String,
    #[serde(default, rename = "type")]
    node_type: String,
    position: GraphPosition,
    #[serde(default)]
    data: Value,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GraphEdgeRecord {
    id: String,
    source: String,
    target: String,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default, rename = "type")]
    edge_type: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GraphDataPayload {
    #[serde(default)]
    nodes: Vec<GraphNodeRecord>,
    #[serde(default)]
    edges: Vec<GraphEdgeRecord>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSummary {
    resource_id: String,
    revision: String,
    node_count: usize,
    edge_count: usize,
    selected_node_count: usize,
    save_status: String,
    has_content: bool,
    last_updated_at: Option<u64>,
}

impl Default for WorkspaceSummary {
    fn default() -> Self {
        Self {
            resource_id: String::from("graph_workspace:active"),
            revision: String::from("rev_0"),
            node_count: 0,
            edge_count: 0,
            selected_node_count: 0,
            save_status: String::from("idle"),
            has_content: false,
            last_updated_at: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BridgeWorkspaceSnapshot {
    graph: GraphDataPayload,
    selected_node_id: Option<String>,
    #[serde(default)]
    selected_node_ids: Vec<String>,
    save_status: String,
    revision: String,
    summary: WorkspaceSummary,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentErrorRecord {
    code: String,
    message: String,
    retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentEventRecord {
    id: String,
    #[serde(rename = "type")]
    event_type: String,
    level: String,
    message: String,
    timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    approval_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resource_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    actor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentTaskRecord {
    id: String,
    session_id: String,
    action_name: String,
    resource_id: String,
    status: String,
    title: String,
    message: String,
    progress_percent: u64,
    created_at: u64,
    updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<AgentErrorRecord>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentApprovalRecord {
    id: String,
    session_id: String,
    task_id: String,
    action_name: String,
    resource_id: String,
    status: String,
    title: String,
    risk_summary: String,
    input_summary: String,
    created_by: String,
    created_at: u64,
    updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolved_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolution_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionRecord {
    id: String,
    goal: String,
    resource_id: String,
    actor: String,
    status: String,
    current_action: String,
    current_step: String,
    created_at: u64,
    updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    ended_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    approval_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<AgentErrorRecord>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BridgeExecutionState {
    latest_session_id: Option<String>,
    #[serde(default)]
    sessions: Vec<AgentSessionRecord>,
    #[serde(default)]
    tasks: Vec<AgentTaskRecord>,
    #[serde(default)]
    approvals: Vec<AgentApprovalRecord>,
    #[serde(default)]
    events: Vec<AgentEventRecord>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeStateSyncPayload {
    reason: String,
    workspace: BridgeWorkspaceSnapshot,
    execution_state: BridgeExecutionState,
    contract: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeManifest {
    version: String,
    transport: String,
    host: String,
    port: u16,
    base_url: String,
    health_url: String,
    contract_url: String,
    events_url: String,
    manifest_path: String,
    updated_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeStatus {
    enabled: bool,
    source: String,
    #[serde(flatten)]
    manifest: BridgeManifest,
}

struct BridgeRuntime {
    manifest: BridgeManifest,
    workspace: BridgeWorkspaceSnapshot,
    execution_state: BridgeExecutionState,
    contract: Value,
    session_counter: u64,
    task_counter: u64,
    approval_counter: u64,
    event_counter: u64,
    revision_counter: u64,
    subscribers: Vec<mpsc::Sender<String>>,
    app_data_dir: PathBuf,
}

struct BridgeAppState {
    inner: Arc<Mutex<BridgeRuntime>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn trim_vec<T>(items: &mut Vec<T>, limit: usize) {
    if items.len() > limit {
        let overflow = items.len() - limit;
        items.drain(0..overflow);
    }
}

fn create_id(prefix: &str, counter: u64) -> String {
    format!("{}_{:04}", prefix, counter)
}

fn parse_counter(id: &str, prefix: &str) -> Option<u64> {
    let suffix = id.strip_prefix(&format!("{}_", prefix))?;
    u64::from_str_radix(suffix, 36)
        .ok()
        .or_else(|| suffix.parse::<u64>().ok())
}

fn resolve_app_data_dir() -> Result<PathBuf, String> {
    let app_dir = dirs_next::data_dir()
        .ok_or("无法获取应用数据目录".to_string())?
        .join("GraphAndTable");
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("创建目录失败: {}", e))?;
    Ok(app_dir)
}

fn resolve_graph_data_path() -> Result<PathBuf, String> {
    Ok(resolve_app_data_dir()?.join("graph_data.json"))
}

fn resolve_bridge_manifest_path() -> Result<PathBuf, String> {
    Ok(resolve_app_data_dir()?.join("bridge_manifest.json"))
}

fn read_graph_data_file() -> GraphDataPayload {
    let file_path = match resolve_graph_data_path() {
        Ok(path) => path,
        Err(_) => return GraphDataPayload::default(),
    };
    let json_str = match std::fs::read_to_string(file_path) {
        Ok(contents) => contents,
        Err(_) => return GraphDataPayload::default(),
    };
    serde_json::from_str::<GraphDataPayload>(&json_str).unwrap_or_default()
}

fn build_graph_data_info_for_path(file_path: &Path) -> GraphDataInfo {
    let metadata = std::fs::metadata(file_path).ok();
    let updated_at = metadata
        .as_ref()
        .and_then(|item| item.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);

    GraphDataInfo {
        backend: String::from("tauri_file"),
        location: file_path.to_string_lossy().to_string(),
        exists: metadata.is_some(),
        byte_size: metadata.map(|item| item.len()).unwrap_or(0),
        updated_at,
    }
}

fn build_current_graph_data_info() -> Result<GraphDataInfo, String> {
    let file_path = resolve_graph_data_path()?;
    Ok(build_graph_data_info_for_path(&file_path))
}

fn next_revision(runtime: &mut BridgeRuntime) -> String {
    runtime.revision_counter += 1;
    format!("rev_{:x}_{:x}", now_ms(), runtime.revision_counter)
}

fn build_workspace_summary(snapshot: &BridgeWorkspaceSnapshot) -> WorkspaceSummary {
    let selected_node_count = if !snapshot.selected_node_ids.is_empty() {
        snapshot.selected_node_ids.len()
    } else if snapshot.selected_node_id.is_some() {
        1
    } else {
        0
    };

    let last_updated_at = snapshot
        .graph
        .nodes
        .iter()
        .filter_map(|node| node.data.get("updatedAt").and_then(Value::as_u64))
        .max();

    WorkspaceSummary {
        resource_id: String::from("graph_workspace:active"),
        revision: snapshot.revision.clone(),
        node_count: snapshot.graph.nodes.len(),
        edge_count: snapshot.graph.edges.len(),
        selected_node_count,
        save_status: snapshot.save_status.clone(),
        has_content: !snapshot.graph.nodes.is_empty() || !snapshot.graph.edges.is_empty(),
        last_updated_at,
    }
}

fn create_default_workspace_snapshot(graph: GraphDataPayload) -> BridgeWorkspaceSnapshot {
    let mut snapshot = BridgeWorkspaceSnapshot {
        graph,
        selected_node_id: None,
        selected_node_ids: Vec::new(),
        save_status: String::from("idle"),
        revision: format!("rev_{:x}", now_ms()),
        summary: WorkspaceSummary::default(),
    };
    snapshot.summary = build_workspace_summary(&snapshot);
    snapshot
}

fn write_bridge_manifest(manifest: &BridgeManifest) -> Result<(), String> {
    let file_path = resolve_bridge_manifest_path()?;
    let json_str = serde_json::to_string_pretty(manifest).map_err(|e| format!("序列化 bridge manifest 失败: {}", e))?;
    std::fs::write(file_path, json_str).map_err(|e| format!("写入 bridge manifest 失败: {}", e))
}

fn result_error(code: &str, message: &str, retryable: bool, details: Option<Value>) -> Value {
    json!({
        "ok": false,
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
            "details": details,
        },
        "task": Value::Null,
        "approval": Value::Null,
        "events": [],
    })
}

fn result_ok(data: Value) -> Value {
    json!({
        "ok": true,
        "data": data,
    })
}

fn ensure_data_object(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = json!({});
    }
    value.as_object_mut().expect("node data 应始终为 object")
}

fn bridge_event(
    runtime: &mut BridgeRuntime,
    event_type: &str,
    level: &str,
    message: &str,
    actor: Option<&str>,
    session_id: Option<String>,
    task_id: Option<String>,
    approval_id: Option<String>,
    data: Option<Value>,
) -> AgentEventRecord {
    let record = AgentEventRecord {
        id: create_id("event", runtime.event_counter),
        event_type: String::from(event_type),
        level: String::from(level),
        message: String::from(message),
        timestamp: now_ms(),
        session_id,
        task_id,
        approval_id,
        resource_id: Some(String::from("graph_workspace:active")),
        actor: actor.map(String::from),
        data,
    };
    runtime.event_counter += 1;
    runtime.execution_state.events.push(record.clone());
    trim_vec(&mut runtime.execution_state.events, MAX_EVENT_COUNT);
    record
}

fn begin_session(runtime: &mut BridgeRuntime, actor: &str, goal: &str, action_name: &str, step: &str) -> AgentSessionRecord {
    let timestamp = now_ms();
    let session = AgentSessionRecord {
        id: create_id("session", runtime.session_counter),
        goal: String::from(goal),
        resource_id: String::from("graph_workspace:active"),
        actor: String::from(actor),
        status: String::from("active"),
        current_action: String::from(action_name),
        current_step: String::from(step),
        created_at: timestamp,
        updated_at: timestamp,
        ended_at: None,
        task_id: None,
        approval_id: None,
        last_error: None,
    };
    runtime.session_counter += 1;
    runtime.execution_state.latest_session_id = Some(session.id.clone());
    runtime.execution_state.sessions.push(session.clone());
    trim_vec(&mut runtime.execution_state.sessions, MAX_SESSION_COUNT);
    session
}

fn create_task(
    runtime: &mut BridgeRuntime,
    session_id: &str,
    action_name: &str,
    status: &str,
    title: &str,
    message: &str,
    progress_percent: u64,
    input_summary: Option<String>,
) -> AgentTaskRecord {
    let timestamp = now_ms();
    let task = AgentTaskRecord {
        id: create_id("task", runtime.task_counter),
        session_id: String::from(session_id),
        action_name: String::from(action_name),
        resource_id: String::from("graph_workspace:active"),
        status: String::from(status),
        title: String::from(title),
        message: String::from(message),
        progress_percent,
        created_at: timestamp,
        updated_at: timestamp,
        completed_at: None,
        input_summary,
        output_summary: None,
        error: None,
    };
    runtime.task_counter += 1;
    runtime.execution_state.tasks.push(task.clone());
    trim_vec(&mut runtime.execution_state.tasks, MAX_TASK_COUNT);
    task
}

fn create_approval(
    runtime: &mut BridgeRuntime,
    session_id: &str,
    task_id: &str,
    action_name: &str,
    title: &str,
    risk_summary: &str,
    input_summary: &str,
    created_by: &str,
    payload: Value,
) -> AgentApprovalRecord {
    let timestamp = now_ms();
    let approval = AgentApprovalRecord {
        id: create_id("approval", runtime.approval_counter),
        session_id: String::from(session_id),
        task_id: String::from(task_id),
        action_name: String::from(action_name),
        resource_id: String::from("graph_workspace:active"),
        status: String::from("requested"),
        title: String::from(title),
        risk_summary: String::from(risk_summary),
        input_summary: String::from(input_summary),
        created_by: String::from(created_by),
        created_at: timestamp,
        updated_at: timestamp,
        resolved_by: None,
        resolution_reason: None,
        payload: Some(payload),
    };
    runtime.approval_counter += 1;
    runtime.execution_state.approvals.push(approval.clone());
    trim_vec(&mut runtime.execution_state.approvals, MAX_APPROVAL_COUNT);
    approval
}

fn find_session_mut<'a>(runtime: &'a mut BridgeRuntime, session_id: &str) -> Option<&'a mut AgentSessionRecord> {
    runtime.execution_state.sessions.iter_mut().find(|session| session.id == session_id)
}

fn find_task_mut<'a>(runtime: &'a mut BridgeRuntime, task_id: &str) -> Option<&'a mut AgentTaskRecord> {
    runtime.execution_state.tasks.iter_mut().find(|task| task.id == task_id)
}

fn find_approval_mut<'a>(runtime: &'a mut BridgeRuntime, approval_id: &str) -> Option<&'a mut AgentApprovalRecord> {
    runtime.execution_state.approvals.iter_mut().find(|approval| approval.id == approval_id)
}

fn get_task(runtime: &BridgeRuntime, task_id: &str) -> Option<AgentTaskRecord> {
    runtime
        .execution_state
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .cloned()
}

fn get_approval(runtime: &BridgeRuntime, approval_id: &str) -> Option<AgentApprovalRecord> {
    runtime
        .execution_state
        .approvals
        .iter()
        .find(|approval| approval.id == approval_id)
        .cloned()
}

fn sync_counters_from_execution(runtime: &mut BridgeRuntime) {
    runtime.session_counter = runtime
        .execution_state
        .sessions
        .iter()
        .filter_map(|item| parse_counter(&item.id, "session"))
        .max()
        .unwrap_or(0)
        + 1;
    runtime.task_counter = runtime
        .execution_state
        .tasks
        .iter()
        .filter_map(|item| parse_counter(&item.id, "task"))
        .max()
        .unwrap_or(0)
        + 1;
    runtime.approval_counter = runtime
        .execution_state
        .approvals
        .iter()
        .filter_map(|item| parse_counter(&item.id, "approval"))
        .max()
        .unwrap_or(0)
        + 1;
    runtime.event_counter = runtime
        .execution_state
        .events
        .iter()
        .filter_map(|item| parse_counter(&item.id, "event"))
        .max()
        .unwrap_or(0)
        + 1;
}

fn update_workspace_after_change(runtime: &mut BridgeRuntime) {
    runtime.workspace.revision = next_revision(runtime);
    runtime.workspace.save_status = String::from("idle");
    runtime.workspace.summary = build_workspace_summary(&runtime.workspace);
}

fn serialize_workspace_json(graph: &GraphDataPayload) -> Result<String, String> {
    serde_json::to_string(graph).map_err(|e| format!("序列化图数据失败: {}", e))
}

fn persist_workspace_snapshot(runtime: &mut BridgeRuntime) -> Result<(), String> {
    let file_path = resolve_graph_data_path()?;
    let json_str = serialize_workspace_json(&runtime.workspace.graph)?;
    std::fs::write(file_path, json_str).map_err(|e| format!("写入文件失败: {}", e))
}

fn selected_subgraph(graph: &GraphDataPayload, selected_ids: &[String]) -> Option<GraphDataPayload> {
    if selected_ids.is_empty() {
        return None;
    }
    let selected_id_set: HashSet<&str> = selected_ids.iter().map(|id| id.as_str()).collect();
    let nodes: Vec<GraphNodeRecord> = graph
        .nodes
        .iter()
        .filter(|node| selected_id_set.contains(node.id.as_str()))
        .cloned()
        .collect();
    if nodes.is_empty() {
        return None;
    }
    let edges: Vec<GraphEdgeRecord> = graph
        .edges
        .iter()
        .filter(|edge| selected_id_set.contains(edge.source.as_str()) && selected_id_set.contains(edge.target.as_str()))
        .cloned()
        .collect();
    Some(GraphDataPayload { nodes, edges })
}

fn resolve_export_path(app_data_dir: &Path, filename: Option<&str>) -> PathBuf {
    match filename {
        Some(value) if !value.trim().is_empty() => {
            let path = PathBuf::from(value);
            if path.is_absolute() {
                path
            } else {
                app_data_dir.join(path)
            }
        }
        _ => app_data_dir.join(format!("graph_export_{}.json", now_ms())),
    }
}

fn action_scope_selected(input: &Value) -> bool {
    input
        .get("scope")
        .and_then(Value::as_str)
        .map(|value| value == "selected")
        .unwrap_or(false)
}

fn publish_state_change(shared: &Arc<Mutex<BridgeRuntime>>, app: &tauri::AppHandle, reason: &str) {
    let (payload, stream_event) = {
        let mut runtime = shared.lock().expect("bridge mutex poisoned");
        runtime.workspace.summary = build_workspace_summary(&runtime.workspace);
        let payload = json!({
            "reason": reason,
            "workspace": runtime.workspace,
            "executionState": runtime.execution_state,
            "contract": runtime.contract,
        });
        let stream_event = json!({
            "type": "bridge.state.changed",
            "reason": reason,
            "timestamp": now_ms(),
            "payload": payload,
        });
        let stream_json = serde_json::to_string(&stream_event).unwrap_or_else(|_| String::from("{}"));
        runtime
            .subscribers
            .retain(|sender| sender.send(stream_json.clone()).is_ok());
        (payload, stream_event)
    };

    let _ = app.emit("agent-bridge://state-changed", payload);
    let _ = app.emit("agent-bridge://stream-event", stream_event);
}

fn handle_query(shared: &Arc<Mutex<BridgeRuntime>>, name: &str, input: &Value) -> Value {
    let runtime = shared.lock().expect("bridge mutex poisoned");

    match name {
        "describe_active_workspace" => result_ok(json!(runtime.workspace.summary)),
        "describe_persistence_target" => match build_current_graph_data_info() {
            Ok(info) => result_ok(json!(info)),
            Err(error) => result_error("EXTERNAL_FAILURE", &error, true, None),
        },
        "get_execution_state" => result_ok(json!(runtime.execution_state)),
        "list_pending_approvals" => {
            let approvals: Vec<AgentApprovalRecord> = runtime
                .execution_state
                .approvals
                .iter()
                .filter(|approval| approval.status == "requested")
                .cloned()
                .collect();
            result_ok(json!(approvals))
        }
        "get_workspace_snapshot" => result_ok(json!(runtime.workspace)),
        "list_nodes" => result_ok(json!(runtime.workspace.graph.nodes)),
        "get_node" => {
            let node_id = input.get("nodeId").and_then(Value::as_str).unwrap_or_default();
            let node = runtime.workspace.graph.nodes.iter().find(|node| node.id == node_id);
            match node {
                Some(record) => result_ok(json!(record)),
                None => result_error("PRECONDITION_FAILED", "节点不存在。", false, None),
            }
        }
        "list_edges" => result_ok(json!(runtime.workspace.graph.edges)),
        "compute_shortest_path" => {
            let start_node_id = input.get("startNodeId").and_then(Value::as_str).unwrap_or_default();
            let end_node_id = input.get("endNodeId").and_then(Value::as_str).unwrap_or_default();
            let mode = input.get("mode").and_then(Value::as_str).unwrap_or("directed");
            let valid_node_ids: HashSet<&str> = runtime
                .workspace
                .graph
                .nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect();
            if !valid_node_ids.contains(start_node_id) || !valid_node_ids.contains(end_node_id) {
                return result_error("PRECONDITION_FAILED", "起点或终点节点不存在。", false, None);
            }

            let mut adjacency: HashMap<&str, Vec<(&str, &str)>> = HashMap::new();
            for edge in &runtime.workspace.graph.edges {
                adjacency
                    .entry(edge.source.as_str())
                    .or_default()
                    .push((edge.target.as_str(), edge.id.as_str()));
                if mode == "undirected" {
                    adjacency
                        .entry(edge.target.as_str())
                        .or_default()
                        .push((edge.source.as_str(), edge.id.as_str()));
                }
            }

            let mut queue = vec![start_node_id];
            let mut visited: HashSet<&str> = HashSet::from([start_node_id]);
            let mut parent: HashMap<&str, (&str, &str)> = HashMap::new();
            let mut head = 0usize;

            while head < queue.len() {
                let current = queue[head];
                head += 1;
                if current == end_node_id {
                    break;
                }

                if let Some(neighbors) = adjacency.get(current) {
                    for (next_node_id, edge_id) in neighbors {
                        if visited.contains(next_node_id) {
                            continue;
                        }
                        visited.insert(next_node_id);
                        parent.insert(next_node_id, (current, edge_id));
                        queue.push(next_node_id);
                    }
                }
            }

            if !visited.contains(end_node_id) {
                return result_ok(json!({
                    "found": false,
                    "nodeIds": [],
                    "edgeIds": [],
                }));
            }

            let mut node_ids = Vec::new();
            let mut edge_ids = Vec::new();
            let mut current = end_node_id;
            loop {
                node_ids.push(String::from(current));
                if let Some((previous, edge_id)) = parent.get(current) {
                    edge_ids.push(String::from(*edge_id));
                    current = previous;
                } else {
                    break;
                }
            }

            node_ids.reverse();
            edge_ids.reverse();

            result_ok(json!({
                "found": true,
                "nodeIds": node_ids,
                "edgeIds": edge_ids,
            }))
        }
        _ => result_error("VALIDATION_FAILED", &format!("未知 query：{}", name), false, None),
    }
}

fn handle_action(shared: &Arc<Mutex<BridgeRuntime>>, app: &tauri::AppHandle, name: &str, input: &Value) -> Value {
    let mut should_publish = false;

    let result = {
        let mut runtime = shared.lock().expect("bridge mutex poisoned");

        match name {
            "save_workspace" => {
                let actor = input.get("actor").and_then(Value::as_str).unwrap_or("human");
                let reason = input.get("reason").and_then(Value::as_str).unwrap_or("manual-save");
                let session = begin_session(&mut runtime, actor, "保存当前工作区", "save_workspace", "persisting_workspace");
                let task = create_task(
                    &mut runtime,
                    &session.id,
                    "save_workspace",
                    "running",
                    "保存当前工作区",
                    "正在写入持久化后端。",
                    10,
                    Some(String::from(reason)),
                );
                if let Some(session_ref) = find_session_mut(&mut runtime, &session.id) {
                    session_ref.task_id = Some(task.id.clone());
                    session_ref.updated_at = now_ms();
                }
                let started_event = bridge_event(
                    &mut runtime,
                    "graph.workspace.save.started",
                    "info",
                    "开始保存当前工作区。",
                    Some(actor),
                    Some(session.id.clone()),
                    Some(task.id.clone()),
                    None,
                    None,
                );

                match persist_workspace_snapshot(&mut runtime) {
                    Ok(_) => {
                        runtime.workspace.save_status = String::from("saved");
                        runtime.workspace.summary = build_workspace_summary(&runtime.workspace);
                        if let Some(session_ref) = find_session_mut(&mut runtime, &session.id) {
                            session_ref.status = String::from("finished");
                            session_ref.current_step = String::from("completed");
                            session_ref.ended_at = Some(now_ms());
                            session_ref.updated_at = now_ms();
                        }
                        if let Some(task_ref) = find_task_mut(&mut runtime, &task.id) {
                            task_ref.status = String::from("succeeded");
                            task_ref.message = String::from("工作区已保存到持久化后端。");
                            task_ref.progress_percent = 100;
                            task_ref.completed_at = Some(now_ms());
                            task_ref.output_summary = Some(format!("revision={}", runtime.workspace.revision));
                            task_ref.updated_at = now_ms();
                        }
                        let completed_event = bridge_event(
                            &mut runtime,
                            "graph.workspace.save.succeeded",
                            "info",
                            "工作区已保存到持久化后端。",
                            Some(actor),
                            Some(session.id.clone()),
                            Some(task.id.clone()),
                            None,
                            None,
                        );
                        should_publish = true;
                        json!({
                            "ok": true,
                            "data": { "summary": runtime.workspace.summary },
                            "task": get_task(&runtime, &task.id),
                            "approval": Value::Null,
                            "events": [started_event, completed_event],
                        })
                    }
                    Err(error) => {
                        let failure = AgentErrorRecord {
                            code: String::from("EXTERNAL_FAILURE"),
                            message: error,
                            retryable: true,
                            details: None,
                        };
                        if let Some(session_ref) = find_session_mut(&mut runtime, &session.id) {
                            session_ref.status = String::from("aborted");
                            session_ref.current_step = String::from("failed");
                            session_ref.ended_at = Some(now_ms());
                            session_ref.updated_at = now_ms();
                            session_ref.last_error = Some(failure.clone());
                        }
                        if let Some(task_ref) = find_task_mut(&mut runtime, &task.id) {
                            task_ref.status = String::from("failed");
                            task_ref.message = String::from("保存工作区失败。");
                            task_ref.progress_percent = 100;
                            task_ref.completed_at = Some(now_ms());
                            task_ref.updated_at = now_ms();
                            task_ref.error = Some(failure.clone());
                        }
                        let failed_event = bridge_event(
                            &mut runtime,
                            "graph.workspace.save.failed",
                            "error",
                            "保存工作区失败。",
                            Some(actor),
                            Some(session.id.clone()),
                            Some(task.id.clone()),
                            None,
                            None,
                        );
                        should_publish = true;
                        json!({
                            "ok": false,
                            "error": failure,
                            "task": get_task(&runtime, &task.id),
                            "approval": Value::Null,
                            "events": [started_event, failed_event],
                        })
                    }
                }
            }
            "import_graph_data" => {
                let actor = input.get("actor").and_then(Value::as_str).unwrap_or("human");
                let replace_existing = input.get("replaceExisting").and_then(Value::as_bool).unwrap_or(false);
                let envelope = input.get("envelope").cloned().unwrap_or(Value::Null);
                let graph_value = envelope.get("graph").cloned().unwrap_or(Value::Null);
                let graph = match serde_json::from_value::<GraphDataPayload>(graph_value) {
                    Ok(value) => value,
                    Err(_) => {
                        return result_error("VALIDATION_FAILED", "导入图数据格式无效。", false, None);
                    }
                };
                let source = envelope.get("source").and_then(Value::as_str).unwrap_or("unknown");
                let warnings = envelope
                    .get("warnings")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();

                if (!runtime.workspace.graph.nodes.is_empty() || !runtime.workspace.graph.edges.is_empty()) && !replace_existing {
                    return result_error(
                        "PRECONDITION_FAILED",
                        "当前工作区已有内容，导入会覆盖现有图谱，请先确认覆盖。",
                        false,
                        Some(json!({ "currentRevision": runtime.workspace.revision })),
                    );
                }

                let session = begin_session(&mut runtime, actor, "替换当前工作区内容", "import_graph_data", "applying_imported_workspace");
                let task = create_task(
                    &mut runtime,
                    &session.id,
                    "import_graph_data",
                    "running",
                    "导入图谱到当前工作区",
                    "正在把导入内容写入活动工作区。",
                    10,
                    Some(format!("source={}", source)),
                );
                if let Some(session_ref) = find_session_mut(&mut runtime, &session.id) {
                    session_ref.task_id = Some(task.id.clone());
                    session_ref.updated_at = now_ms();
                }
                let started_event = bridge_event(
                    &mut runtime,
                    "graph.workspace.import.started",
                    "info",
                    "开始导入图谱到当前工作区。",
                    Some(actor),
                    Some(session.id.clone()),
                    Some(task.id.clone()),
                    None,
                    Some(json!({ "source": source })),
                );

                runtime.workspace.graph = graph;
                runtime.workspace.selected_node_id = None;
                runtime.workspace.selected_node_ids.clear();
                update_workspace_after_change(&mut runtime);

                if let Some(session_ref) = find_session_mut(&mut runtime, &session.id) {
                    session_ref.status = String::from("finished");
                    session_ref.current_step = String::from("completed");
                    session_ref.ended_at = Some(now_ms());
                    session_ref.updated_at = now_ms();
                }
                if let Some(task_ref) = find_task_mut(&mut runtime, &task.id) {
                    task_ref.status = String::from("succeeded");
                    task_ref.message = format!(
                        "导入完成：{} 个节点，{} 条连线。",
                        runtime.workspace.graph.nodes.len(),
                        runtime.workspace.graph.edges.len()
                    );
                    task_ref.progress_percent = 100;
                    task_ref.completed_at = Some(now_ms());
                    task_ref.output_summary = Some(format!("revision={}", runtime.workspace.revision));
                    task_ref.updated_at = now_ms();
                }
                let completed_event = bridge_event(
                    &mut runtime,
                    "graph.workspace.import.succeeded",
                    "info",
                    "导入图谱完成。",
                    Some(actor),
                    Some(session.id.clone()),
                    Some(task.id.clone()),
                    None,
                    None,
                );
                should_publish = true;
                json!({
                    "ok": true,
                    "data": {
                        "summary": runtime.workspace.summary,
                        "warnings": warnings,
                        "source": source,
                    },
                    "task": get_task(&runtime, &task.id),
                    "approval": Value::Null,
                    "events": [started_event, completed_event],
                })
            }
            "request_json_export" => {
                let actor = input.get("actor").and_then(Value::as_str).unwrap_or("human");
                let scope = if action_scope_selected(input) { "selected" } else { "all" };
                let filename = input.get("filename").and_then(Value::as_str);
                let reason = input.get("reason").and_then(Value::as_str).unwrap_or_default();

                if scope == "selected" && runtime.workspace.selected_node_ids.is_empty() && runtime.workspace.selected_node_id.is_none() {
                    return result_error("PRECONDITION_FAILED", "当前没有可导出的选中节点，请先选中节点后再导出。", false, None);
                }

                let session = begin_session(
                    &mut runtime,
                    actor,
                    if scope == "selected" { "导出选中子图 JSON" } else { "导出当前工作区 JSON" },
                    "request_json_export",
                    "awaiting_approval",
                );
                let task = create_task(
                    &mut runtime,
                    &session.id,
                    "request_json_export",
                    "blocked",
                    if scope == "selected" { "导出选中子图 JSON" } else { "导出工作区 JSON" },
                    "等待人工审批后执行导出。",
                    15,
                    Some(format!("scope={}", scope)),
                );
                if let Some(session_ref) = find_session_mut(&mut runtime, &session.id) {
                    session_ref.task_id = Some(task.id.clone());
                    session_ref.status = String::from("paused");
                    session_ref.current_step = String::from("pending_approval");
                    session_ref.updated_at = now_ms();
                }

                let approval = create_approval(
                    &mut runtime,
                    &session.id,
                    &task.id,
                    "request_json_export",
                    if scope == "selected" { "审批：导出选中子图 JSON" } else { "审批：导出工作区 JSON" },
                    "该动作会把当前图谱写出到外部文件系统，属于高风险外部写入。",
                    &format!(
                        "scope={}{}",
                        scope,
                        filename.map(|value| format!(", filename={}", value)).unwrap_or_default()
                    ),
                    actor,
                    json!({
                        "scope": scope,
                        "filename": filename,
                        "expectedRevision": runtime.workspace.revision,
                        "reason": reason,
                    }),
                );
                if let Some(session_ref) = find_session_mut(&mut runtime, &session.id) {
                    session_ref.approval_id = Some(approval.id.clone());
                    session_ref.updated_at = now_ms();
                }

                let started_event = bridge_event(
                    &mut runtime,
                    "agent.step.started",
                    "info",
                    "已创建受管导出请求。",
                    Some(actor),
                    Some(session.id.clone()),
                    Some(task.id.clone()),
                    Some(approval.id.clone()),
                    Some(json!({ "scope": scope })),
                );
                let blocked_event = bridge_event(
                    &mut runtime,
                    "graph.workspace.export.requires_approval",
                    "warning",
                    "导出动作已阻塞，等待人工审批。",
                    Some(actor),
                    Some(session.id.clone()),
                    Some(task.id.clone()),
                    Some(approval.id.clone()),
                    Some(json!({ "scope": scope, "revision": runtime.workspace.revision })),
                );

                should_publish = true;
                json!({
                    "ok": false,
                    "data": {
                        "summary": runtime.workspace.summary,
                        "scope": scope,
                    },
                    "task": get_task(&runtime, &task.id),
                    "approval": get_approval(&runtime, &approval.id),
                    "events": [started_event, blocked_event],
                    "error": {
                        "code": "APPROVAL_REQUIRED",
                        "message": "导出前需要人工审批。",
                        "retryable": false,
                        "details": {
                            "approvalId": approval.id,
                            "taskId": task.id,
                        }
                    }
                })
            }
            "take_over_session" => {
                let actor = input.get("actor").and_then(Value::as_str).unwrap_or("supervisor");
                let requested_session_id = input.get("sessionId").and_then(Value::as_str);
                let target_session_id = requested_session_id
                    .map(String::from)
                    .or_else(|| runtime.execution_state.latest_session_id.clone());

                let Some(session_id) = target_session_id else {
                    return result_error("PRECONDITION_FAILED", "当前没有可接管的 session。", false, None);
                };

                let task_id = runtime
                    .execution_state
                    .sessions
                    .iter()
                    .find(|session| session.id == session_id)
                    .and_then(|session| session.task_id.clone());
                let approval_id = runtime
                    .execution_state
                    .sessions
                    .iter()
                    .find(|session| session.id == session_id)
                    .and_then(|session| session.approval_id.clone());

                if let Some(session_ref) = find_session_mut(&mut runtime, &session_id) {
                    session_ref.status = String::from("taken_over");
                    session_ref.current_step = String::from("taken_over_by_human");
                    session_ref.ended_at = Some(now_ms());
                    session_ref.updated_at = now_ms();
                } else {
                    return result_error("PRECONDITION_FAILED", "当前没有可接管的 session。", false, None);
                }

                let event = bridge_event(
                    &mut runtime,
                    "agent.session.taken_over",
                    "warning",
                    input
                        .get("reason")
                        .and_then(Value::as_str)
                        .unwrap_or("人工已接管当前 session。"),
                    Some(actor),
                    Some(session_id.clone()),
                    task_id.clone(),
                    approval_id.clone(),
                    None,
                );
                should_publish = true;
                json!({
                    "ok": true,
                    "data": { "sessionId": session_id },
                    "task": task_id.and_then(|id| get_task(&runtime, &id)),
                    "approval": approval_id.and_then(|id| get_approval(&runtime, &id)),
                    "events": [event],
                })
            }
            "create_node" => {
                let position = input.get("position").cloned().unwrap_or_else(|| json!({ "x": 200.0, "y": 200.0 }));
                let label = input.get("label").and_then(Value::as_str).unwrap_or("新知识点");
                let content = input.get("content").and_then(Value::as_str).unwrap_or("");
                let node_id = format!("node_{}_{}", now_ms(), runtime.revision_counter + 1);
                let timestamp = now_ms();
                runtime.workspace.graph.nodes.push(GraphNodeRecord {
                    id: node_id.clone(),
                    node_type: String::from("knowledgeNode"),
                    position: serde_json::from_value(position).unwrap_or(GraphPosition { x: 200.0, y: 200.0 }),
                    data: json!({
                        "label": label,
                        "content": content,
                        "tags": [],
                        "createdAt": timestamp,
                        "updatedAt": timestamp,
                    }),
                });
                runtime.workspace.selected_node_id = Some(node_id.clone());
                runtime.workspace.selected_node_ids = vec![node_id.clone()];
                update_workspace_after_change(&mut runtime);
                let event = bridge_event(
                    &mut runtime,
                    "graph.workspace.changed",
                    "info",
                    "已创建节点。",
                    input.get("actor").and_then(Value::as_str),
                    None,
                    None,
                    None,
                    Some(json!({ "nodeId": node_id })),
                );
                should_publish = true;
                json!({
                    "ok": true,
                    "data": {
                        "nodeId": node_id,
                        "summary": runtime.workspace.summary,
                    },
                    "task": Value::Null,
                    "approval": Value::Null,
                    "events": [event],
                })
            }
            "update_node" => {
                let node_id = input.get("nodeId").and_then(Value::as_str).unwrap_or_default();
                let patch = input.get("patch").and_then(Value::as_object);
                let Some(patch_map) = patch else {
                    return result_error("VALIDATION_FAILED", "patch 不能为空。", false, None);
                };

                let Some(node) = runtime.workspace.graph.nodes.iter_mut().find(|node| node.id == node_id) else {
                    return result_error("PRECONDITION_FAILED", "节点不存在。", false, None);
                };

                if let Some(position_value) = patch_map.get("position") {
                    if let Ok(position) = serde_json::from_value::<GraphPosition>(position_value.clone()) {
                        node.position = position;
                    }
                }

                let data_object = ensure_data_object(&mut node.data);
                if let Some(data_patch) = patch_map.get("data").and_then(Value::as_object) {
                    for (key, value) in data_patch {
                        data_object.insert(key.clone(), value.clone());
                    }
                }
                for (key, value) in patch_map {
                    if key == "position" || key == "data" {
                        continue;
                    }
                    data_object.insert(key.clone(), value.clone());
                }
                data_object.insert(String::from("updatedAt"), json!(now_ms()));

                update_workspace_after_change(&mut runtime);
                let event = bridge_event(
                    &mut runtime,
                    "graph.workspace.changed",
                    "info",
                    "已更新节点。",
                    input.get("actor").and_then(Value::as_str),
                    None,
                    None,
                    None,
                    Some(json!({ "nodeId": node_id })),
                );
                should_publish = true;
                json!({
                    "ok": true,
                    "data": { "nodeId": node_id, "summary": runtime.workspace.summary },
                    "task": Value::Null,
                    "approval": Value::Null,
                    "events": [event],
                })
            }
            "delete_nodes" => {
                let node_ids = input
                    .get("nodeIds")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|value| value.as_str().map(String::from))
                    .collect::<Vec<String>>();
                if node_ids.is_empty() {
                    return result_error("PRECONDITION_FAILED", "nodeIds 不能为空。", false, None);
                }
                let node_id_set: HashSet<&str> = node_ids.iter().map(|id| id.as_str()).collect();
                let previous_node_count = runtime.workspace.graph.nodes.len();
                runtime.workspace.graph.nodes.retain(|node| !node_id_set.contains(node.id.as_str()));
                runtime.workspace.graph.edges.retain(|edge| {
                    !node_id_set.contains(edge.source.as_str()) && !node_id_set.contains(edge.target.as_str())
                });
                if runtime.workspace.graph.nodes.len() == previous_node_count {
                    return result_error("PRECONDITION_FAILED", "未找到可删除的节点。", false, None);
                }
                runtime.workspace.selected_node_ids.retain(|id| !node_id_set.contains(id.as_str()));
                if runtime
                    .workspace
                    .selected_node_id
                    .as_ref()
                    .map(|id| node_id_set.contains(id.as_str()))
                    .unwrap_or(false)
                {
                    runtime.workspace.selected_node_id = runtime.workspace.selected_node_ids.first().cloned();
                }
                update_workspace_after_change(&mut runtime);
                let event = bridge_event(
                    &mut runtime,
                    "graph.workspace.changed",
                    "warning",
                    "已删除节点。",
                    input.get("actor").and_then(Value::as_str),
                    None,
                    None,
                    None,
                    Some(json!({ "nodeIds": node_ids })),
                );
                should_publish = true;
                json!({
                    "ok": true,
                    "data": { "deletedNodeCount": previous_node_count - runtime.workspace.graph.nodes.len(), "summary": runtime.workspace.summary },
                    "task": Value::Null,
                    "approval": Value::Null,
                    "events": [event],
                })
            }
            "duplicate_nodes" => {
                let mut node_ids = input
                    .get("nodeIds")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|value| value.as_str().map(String::from))
                    .collect::<Vec<String>>();
                if node_ids.is_empty() {
                    node_ids = if !runtime.workspace.selected_node_ids.is_empty() {
                        runtime.workspace.selected_node_ids.clone()
                    } else {
                        runtime.workspace.selected_node_id.clone().into_iter().collect()
                    };
                }
                if node_ids.is_empty() {
                    return result_error("PRECONDITION_FAILED", "请先提供 nodeIds 或在 UI 中选中节点。", false, None);
                }

                let selected_set: HashSet<&str> = node_ids.iter().map(|id| id.as_str()).collect();
                let selected_nodes: Vec<GraphNodeRecord> = runtime
                    .workspace
                    .graph
                    .nodes
                    .iter()
                    .filter(|node| selected_set.contains(node.id.as_str()))
                    .cloned()
                    .collect();
                if selected_nodes.is_empty() {
                    return result_error("PRECONDITION_FAILED", "选中节点不存在或已被删除。", false, None);
                }

                let selected_edges: Vec<GraphEdgeRecord> = runtime
                    .workspace
                    .graph
                    .edges
                    .iter()
                    .filter(|edge| selected_set.contains(edge.source.as_str()) && selected_set.contains(edge.target.as_str()))
                    .cloned()
                    .collect();

                let mut id_map: HashMap<String, String> = HashMap::new();
                let timestamp = now_ms();
                let mut duplicated_nodes = Vec::new();
                let mut duplicated_node_ids = Vec::new();
                for node in selected_nodes {
                    let next_id = format!("node_{}_{}", timestamp, runtime.revision_counter + duplicated_nodes.len() as u64 + 1);
                    id_map.insert(node.id.clone(), next_id.clone());
                    duplicated_node_ids.push(next_id.clone());
                    let mut next_node = node.clone();
                    next_node.id = next_id;
                    next_node.position = GraphPosition {
                        x: node.position.x + 40.0,
                        y: node.position.y + 40.0,
                    };
                    let data_object = ensure_data_object(&mut next_node.data);
                    let current_label = data_object
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or("未命名");
                    data_object.insert(String::from("label"), json!(format!("{} (副本)", current_label)));
                    data_object.insert(String::from("createdAt"), json!(timestamp));
                    data_object.insert(String::from("updatedAt"), json!(timestamp));
                    duplicated_nodes.push(next_node);
                }

                let mut duplicated_edges = Vec::new();
                for edge in selected_edges {
                    let Some(next_source) = id_map.get(&edge.source) else { continue };
                    let Some(next_target) = id_map.get(&edge.target) else { continue };
                    duplicated_edges.push(GraphEdgeRecord {
                        id: format!("edge_{}_{}", timestamp, runtime.revision_counter + duplicated_edges.len() as u64 + 1),
                        source: next_source.clone(),
                        target: next_target.clone(),
                        label: edge.label.clone(),
                        data: edge.data.clone(),
                        edge_type: Some(String::from("centerEdge")),
                    });
                }

                runtime.workspace.graph.nodes.extend(duplicated_nodes);
                runtime.workspace.graph.edges.extend(duplicated_edges.clone());
                runtime.workspace.selected_node_id = duplicated_node_ids.first().cloned();
                runtime.workspace.selected_node_ids = duplicated_node_ids.clone();
                update_workspace_after_change(&mut runtime);
                let event = bridge_event(
                    &mut runtime,
                    "graph.workspace.changed",
                    "info",
                    "已复制节点。",
                    input.get("actor").and_then(Value::as_str),
                    None,
                    None,
                    None,
                    Some(json!({
                        "nodeCount": duplicated_node_ids.len(),
                        "edgeCount": duplicated_edges.len(),
                    })),
                );
                should_publish = true;
                json!({
                    "ok": true,
                    "data": {
                        "nodeIds": duplicated_node_ids,
                        "edgeCount": duplicated_edges.len(),
                        "summary": runtime.workspace.summary,
                    },
                    "task": Value::Null,
                    "approval": Value::Null,
                    "events": [event],
                })
            }
            "create_edge" => {
                let source = input.get("source").and_then(Value::as_str).unwrap_or_default();
                let target = input.get("target").and_then(Value::as_str).unwrap_or_default();
                let valid_node_ids: HashSet<&str> = runtime.workspace.graph.nodes.iter().map(|node| node.id.as_str()).collect();
                if !valid_node_ids.contains(source) || !valid_node_ids.contains(target) {
                    return result_error("PRECONDITION_FAILED", "source 或 target 节点不存在。", false, None);
                }
                let edge_id = format!("edge_{}_{}", now_ms(), runtime.revision_counter + 1);
                runtime.workspace.graph.edges.push(GraphEdgeRecord {
                    id: edge_id.clone(),
                    source: String::from(source),
                    target: String::from(target),
                    label: input.get("label").and_then(Value::as_str).map(String::from),
                    data: None,
                    edge_type: Some(String::from("centerEdge")),
                });
                update_workspace_after_change(&mut runtime);
                let event = bridge_event(
                    &mut runtime,
                    "graph.workspace.changed",
                    "info",
                    "已创建连线。",
                    input.get("actor").and_then(Value::as_str),
                    None,
                    None,
                    None,
                    Some(json!({ "edgeId": edge_id })),
                );
                should_publish = true;
                json!({
                    "ok": true,
                    "data": { "edgeId": edge_id, "summary": runtime.workspace.summary },
                    "task": Value::Null,
                    "approval": Value::Null,
                    "events": [event],
                })
            }
            "update_edge_label" => {
                let edge_id = input.get("edgeId").and_then(Value::as_str).unwrap_or_default();
                let label = input.get("label").and_then(Value::as_str).unwrap_or_default();
                let Some(edge) = runtime.workspace.graph.edges.iter_mut().find(|edge| edge.id == edge_id) else {
                    return result_error("PRECONDITION_FAILED", "连线不存在。", false, None);
                };
                edge.label = Some(String::from(label));
                if let Some(data) = edge.data.as_mut() {
                    let data_object = ensure_data_object(data);
                    data_object.insert(String::from("label"), json!(label));
                }
                update_workspace_after_change(&mut runtime);
                let event = bridge_event(
                    &mut runtime,
                    "graph.workspace.changed",
                    "info",
                    "已更新连线标签。",
                    input.get("actor").and_then(Value::as_str),
                    None,
                    None,
                    None,
                    Some(json!({ "edgeId": edge_id })),
                );
                should_publish = true;
                json!({
                    "ok": true,
                    "data": { "edgeId": edge_id, "summary": runtime.workspace.summary },
                    "task": Value::Null,
                    "approval": Value::Null,
                    "events": [event],
                })
            }
            "delete_edges" => {
                let edge_ids = input
                    .get("edgeIds")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|value| value.as_str().map(String::from))
                    .collect::<Vec<String>>();
                if edge_ids.is_empty() {
                    return result_error("PRECONDITION_FAILED", "edgeIds 不能为空。", false, None);
                }
                let edge_id_set: HashSet<&str> = edge_ids.iter().map(|id| id.as_str()).collect();
                let previous_edge_count = runtime.workspace.graph.edges.len();
                runtime.workspace.graph.edges.retain(|edge| !edge_id_set.contains(edge.id.as_str()));
                if runtime.workspace.graph.edges.len() == previous_edge_count {
                    return result_error("PRECONDITION_FAILED", "未找到可删除的连线。", false, None);
                }
                update_workspace_after_change(&mut runtime);
                let event = bridge_event(
                    &mut runtime,
                    "graph.workspace.changed",
                    "warning",
                    "已删除连线。",
                    input.get("actor").and_then(Value::as_str),
                    None,
                    None,
                    None,
                    Some(json!({ "edgeIds": edge_ids })),
                );
                should_publish = true;
                json!({
                    "ok": true,
                    "data": { "deletedEdgeCount": previous_edge_count - runtime.workspace.graph.edges.len(), "summary": runtime.workspace.summary },
                    "task": Value::Null,
                    "approval": Value::Null,
                    "events": [event],
                })
            }
            _ => result_error("VALIDATION_FAILED", &format!("未知 action：{}", name), false, None),
        }
    };

    if should_publish {
        publish_state_change(shared, app, name);
    }
    result
}

fn handle_approval(shared: &Arc<Mutex<BridgeRuntime>>, app: &tauri::AppHandle, name: &str, input: &Value) -> Value {
    let mut should_publish = false;

    let result = {
        let mut runtime = shared.lock().expect("bridge mutex poisoned");
        match name {
            "approve_pending_action" => {
                let approval_id = input.get("approvalId").and_then(Value::as_str).unwrap_or_default();
                let actor = input.get("actor").and_then(Value::as_str).unwrap_or("supervisor");

                let Some(approval_index) = runtime
                    .execution_state
                    .approvals
                    .iter()
                    .position(|approval| approval.id == approval_id && approval.status == "requested")
                else {
                    return result_error("PRECONDITION_FAILED", "审批不存在，或已经不是待处理状态。", false, None);
                };

                let approval = runtime.execution_state.approvals[approval_index].clone();
                let expected_revision = approval
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("expectedRevision"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();

                if runtime.workspace.revision != expected_revision {
                    if let Some(approval_ref) = find_approval_mut(&mut runtime, &approval.id) {
                        approval_ref.status = String::from("expired");
                        approval_ref.resolved_by = Some(String::from(actor));
                        approval_ref.resolution_reason = Some(String::from("revision_changed"));
                        approval_ref.updated_at = now_ms();
                    }
                    if let Some(task_ref) = find_task_mut(&mut runtime, &approval.task_id) {
                        task_ref.status = String::from("failed");
                        task_ref.message = String::from("审批已失效，工作区 revision 已变化。");
                        task_ref.progress_percent = 100;
                        task_ref.completed_at = Some(now_ms());
                        task_ref.updated_at = now_ms();
                        task_ref.error = Some(AgentErrorRecord {
                            code: String::from("CONCURRENCY_CONFLICT"),
                            message: String::from("工作区自审批申请后已变化，请重新发起导出。"),
                            retryable: true,
                            details: Some(json!({
                                "expectedRevision": expected_revision,
                                "currentRevision": runtime.workspace.revision,
                            })),
                        });
                    }
                    if let Some(session_ref) = find_session_mut(&mut runtime, &approval.session_id) {
                        session_ref.status = String::from("aborted");
                        session_ref.current_step = String::from("revision_conflict");
                        session_ref.ended_at = Some(now_ms());
                        session_ref.updated_at = now_ms();
                    }
                    let event = bridge_event(
                        &mut runtime,
                        "graph.workspace.export.failed",
                        "error",
                        "审批已失效，导出前检测到工作区 revision 冲突。",
                        Some(actor),
                        Some(approval.session_id.clone()),
                        Some(approval.task_id.clone()),
                        Some(approval.id.clone()),
                        Some(json!({
                            "expectedRevision": expected_revision,
                            "currentRevision": runtime.workspace.revision,
                        })),
                    );
                    should_publish = true;
                    json!({
                        "ok": false,
                        "error": {
                            "code": "CONCURRENCY_CONFLICT",
                            "message": "工作区自审批申请后已变化，请重新发起导出。",
                            "retryable": true,
                            "details": {
                                "expectedRevision": expected_revision,
                                "currentRevision": runtime.workspace.revision,
                            }
                        },
                        "task": get_task(&runtime, &approval.task_id),
                        "approval": get_approval(&runtime, &approval.id),
                        "events": [event],
                    })
                } else {
                    let scope = approval
                        .payload
                        .as_ref()
                        .and_then(|payload| payload.get("scope"))
                        .and_then(Value::as_str)
                        .unwrap_or("all");
                    let filename = approval
                        .payload
                        .as_ref()
                        .and_then(|payload| payload.get("filename"))
                        .and_then(Value::as_str);

                    let selected_ids = if !runtime.workspace.selected_node_ids.is_empty() {
                        runtime.workspace.selected_node_ids.clone()
                    } else {
                        runtime.workspace.selected_node_id.clone().into_iter().collect::<Vec<String>>()
                    };
                    let export_graph = if scope == "selected" {
                        selected_subgraph(&runtime.workspace.graph, &selected_ids)
                    } else {
                        Some(runtime.workspace.graph.clone())
                    };

                    let Some(export_graph) = export_graph else {
                        return result_error("PRECONDITION_FAILED", "当前没有可导出的选中节点，请重新选择后再审批。", false, None);
                    };

                    if let Some(approval_ref) = find_approval_mut(&mut runtime, &approval.id) {
                        approval_ref.status = String::from("approved");
                        approval_ref.resolved_by = Some(String::from(actor));
                        approval_ref.resolution_reason = Some(String::from("approved_in_bridge"));
                        approval_ref.updated_at = now_ms();
                    }
                    if let Some(session_ref) = find_session_mut(&mut runtime, &approval.session_id) {
                        session_ref.status = String::from("active");
                        session_ref.current_step = String::from("exporting_json");
                        session_ref.updated_at = now_ms();
                    }
                    if let Some(task_ref) = find_task_mut(&mut runtime, &approval.task_id) {
                        task_ref.status = String::from("running");
                        task_ref.message = String::from("审批通过，开始写出 JSON 文件。");
                        task_ref.progress_percent = 45;
                        task_ref.updated_at = now_ms();
                    }

                    let running_event = bridge_event(
                        &mut runtime,
                        "graph.workspace.export.running",
                        "info",
                        "审批通过，开始执行 JSON 导出。",
                        Some(actor),
                        Some(approval.session_id.clone()),
                        Some(approval.task_id.clone()),
                        Some(approval.id.clone()),
                        Some(json!({ "scope": scope, "revision": runtime.workspace.revision })),
                    );

                    let export_path = resolve_export_path(&runtime.app_data_dir, filename);
                    let result = serialize_workspace_json(&export_graph)
                        .and_then(|json_str| std::fs::write(&export_path, json_str).map_err(|e| format!("写入导出文件失败: {}", e)));

                    match result {
                        Ok(_) => {
                            if let Some(session_ref) = find_session_mut(&mut runtime, &approval.session_id) {
                                session_ref.status = String::from("finished");
                                session_ref.current_step = String::from("completed");
                                session_ref.ended_at = Some(now_ms());
                                session_ref.updated_at = now_ms();
                            }
                            if let Some(task_ref) = find_task_mut(&mut runtime, &approval.task_id) {
                                task_ref.status = String::from("succeeded");
                                task_ref.message = String::from("JSON 导出已完成。");
                                task_ref.progress_percent = 100;
                                task_ref.completed_at = Some(now_ms());
                                task_ref.output_summary = Some(format!("scope={}", scope));
                                task_ref.updated_at = now_ms();
                            }
                            let completed_event = bridge_event(
                                &mut runtime,
                                "graph.workspace.export.succeeded",
                                "info",
                                "JSON 导出已完成。",
                                Some(actor),
                                Some(approval.session_id.clone()),
                                Some(approval.task_id.clone()),
                                Some(approval.id.clone()),
                                Some(json!({ "path": export_path })),
                            );
                            should_publish = true;
                            json!({
                                "ok": true,
                                "data": {
                                    "summary": runtime.workspace.summary,
                                    "exportPath": export_path.to_string_lossy(),
                                },
                                "task": get_task(&runtime, &approval.task_id),
                                "approval": get_approval(&runtime, &approval.id),
                                "events": [running_event, completed_event],
                            })
                        }
                        Err(error) => {
                            let failure = AgentErrorRecord {
                                code: String::from("EXTERNAL_FAILURE"),
                                message: error,
                                retryable: true,
                                details: None,
                            };
                            if let Some(session_ref) = find_session_mut(&mut runtime, &approval.session_id) {
                                session_ref.status = String::from("aborted");
                                session_ref.current_step = String::from("failed");
                                session_ref.ended_at = Some(now_ms());
                                session_ref.updated_at = now_ms();
                                session_ref.last_error = Some(failure.clone());
                            }
                            if let Some(task_ref) = find_task_mut(&mut runtime, &approval.task_id) {
                                task_ref.status = String::from("failed");
                                task_ref.message = String::from("JSON 导出失败。");
                                task_ref.progress_percent = 100;
                                task_ref.completed_at = Some(now_ms());
                                task_ref.updated_at = now_ms();
                                task_ref.error = Some(failure.clone());
                            }
                            let failed_event = bridge_event(
                                &mut runtime,
                                "graph.workspace.export.failed",
                                "error",
                                "JSON 导出失败。",
                                Some(actor),
                                Some(approval.session_id.clone()),
                                Some(approval.task_id.clone()),
                                Some(approval.id.clone()),
                                None,
                            );
                            should_publish = true;
                            json!({
                                "ok": false,
                                "error": failure,
                                "task": get_task(&runtime, &approval.task_id),
                                "approval": get_approval(&runtime, &approval.id),
                                "events": [running_event, failed_event],
                            })
                        }
                    }
                }
            }
            "reject_pending_action" => {
                let approval_id = input.get("approvalId").and_then(Value::as_str).unwrap_or_default();
                let actor = input.get("actor").and_then(Value::as_str).unwrap_or("supervisor");
                let reason = input.get("reason").and_then(Value::as_str).unwrap_or("operator_rejected");

                let Some(approval) = runtime
                    .execution_state
                    .approvals
                    .iter()
                    .find(|approval| approval.id == approval_id && approval.status == "requested")
                    .cloned()
                else {
                    return result_error("PRECONDITION_FAILED", "审批不存在，或已经不是待处理状态。", false, None);
                };

                if let Some(approval_ref) = find_approval_mut(&mut runtime, &approval.id) {
                    approval_ref.status = String::from("rejected");
                    approval_ref.resolved_by = Some(String::from(actor));
                    approval_ref.resolution_reason = Some(String::from(reason));
                    approval_ref.updated_at = now_ms();
                }
                if let Some(task_ref) = find_task_mut(&mut runtime, &approval.task_id) {
                    task_ref.status = String::from("cancelled");
                    task_ref.message = String::from("审批被拒绝，导出已取消。");
                    task_ref.progress_percent = 100;
                    task_ref.completed_at = Some(now_ms());
                    task_ref.updated_at = now_ms();
                }
                if let Some(session_ref) = find_session_mut(&mut runtime, &approval.session_id) {
                    session_ref.status = String::from("aborted");
                    session_ref.current_step = String::from("approval_rejected");
                    session_ref.ended_at = Some(now_ms());
                    session_ref.updated_at = now_ms();
                }

                let event = bridge_event(
                    &mut runtime,
                    "graph.workspace.export.failed",
                    "warning",
                    "导出审批被拒绝，任务已取消。",
                    Some(actor),
                    Some(approval.session_id.clone()),
                    Some(approval.task_id.clone()),
                    Some(approval.id.clone()),
                    Some(json!({ "reason": reason })),
                );
                should_publish = true;
                json!({
                    "ok": true,
                    "data": {
                        "approval": get_approval(&runtime, &approval.id),
                    },
                    "task": get_task(&runtime, &approval.task_id),
                    "approval": get_approval(&runtime, &approval.id),
                    "events": [event],
                })
            }
            _ => result_error("VALIDATION_FAILED", &format!("未知 approval：{}", name), false, None),
        }
    };

    if should_publish {
        publish_state_change(shared, app, name);
    }
    result
}

fn handle_bridge_request(
    shared: &Arc<Mutex<BridgeRuntime>>,
    app: &tauri::AppHandle,
    kind: &str,
    name: &str,
    input: &Value,
) -> Value {
    match kind {
        "query" => handle_query(shared, name, input),
        "action" => handle_action(shared, app, name, input),
        "approval" => handle_approval(shared, app, name, input),
        _ => result_error("VALIDATION_FAILED", "未知 bridge 请求类型。", false, None),
    }
}

fn read_http_request(stream: &mut TcpStream) -> Result<(String, String, HashMap<String, String>, Vec<u8>), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| format!("设置读取超时失败: {}", e))?;

    let mut buffer = Vec::new();
    let mut temp = [0u8; 2048];
    let mut header_end = None;

    while header_end.is_none() {
        let read_bytes = stream.read(&mut temp).map_err(|e| format!("读取请求失败: {}", e))?;
        if read_bytes == 0 {
            break;
        }
        buffer.extend_from_slice(&temp[..read_bytes]);
        header_end = buffer.windows(4).position(|window| window == b"\r\n\r\n");
        if buffer.len() > 1024 * 1024 {
            return Err(String::from("HTTP 请求过大。"));
        }
    }

    let Some(header_end_index) = header_end else {
        return Err(String::from("HTTP 请求头不完整。"));
    };
    let header_bytes = &buffer[..header_end_index];
    let mut body = buffer[(header_end_index + 4)..].to_vec();
    let header_text = String::from_utf8_lossy(header_bytes).to_string();
    let mut lines = header_text.lines();
    let request_line = lines.next().ok_or("缺少请求行".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    while body.len() < content_length {
        let read_bytes = stream.read(&mut temp).map_err(|e| format!("读取请求体失败: {}", e))?;
        if read_bytes == 0 {
            break;
        }
        body.extend_from_slice(&temp[..read_bytes]);
    }
    body.truncate(content_length);
    Ok((method, path, headers, body))
}

fn write_json_response(stream: &mut TcpStream, status: &str, payload: &Value) {
    let body = serde_json::to_vec(payload).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
    let headers = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
        status,
        body.len()
    );
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.write_all(&body);
}

fn write_sse_response(stream: &mut TcpStream) {
    let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
    let _ = stream.write_all(headers.as_bytes());
}

fn handle_http_connection(shared: Arc<Mutex<BridgeRuntime>>, app: tauri::AppHandle, mut stream: TcpStream) {
    match read_http_request(&mut stream) {
        Ok((method, path, _headers, body)) => match (method.as_str(), path.as_str()) {
            ("GET", "/health") => {
                let payload = json!({ "ok": true, "transport": "tauri_loopback_http", "timestamp": now_ms() });
                write_json_response(&mut stream, "200 OK", &payload);
            }
            ("GET", "/v1/contract") => {
                let payload = {
                    let runtime = shared.lock().expect("bridge mutex poisoned");
                    runtime.contract.clone()
                };
                write_json_response(&mut stream, "200 OK", &payload);
            }
            ("GET", "/v1/events") => {
                write_sse_response(&mut stream);
                let receiver = {
                    let mut runtime = shared.lock().expect("bridge mutex poisoned");
                    let (sender, receiver) = mpsc::channel::<String>();
                    runtime.subscribers.push(sender);
                    let initial_payload = json!({
                        "type": "bridge.state.snapshot",
                        "reason": "stream_connected",
                        "timestamp": now_ms(),
                        "payload": {
                            "reason": "stream_connected",
                            "workspace": runtime.workspace,
                            "executionState": runtime.execution_state,
                            "contract": runtime.contract,
                        }
                    });
                    let frame = format!("event: state\ndata: {}\n\n", initial_payload);
                    let _ = stream.write_all(frame.as_bytes());
                    receiver
                };

                loop {
                    match receiver.recv_timeout(Duration::from_secs(15)) {
                        Ok(message) => {
                            let frame = format!("event: state\ndata: {}\n\n", message);
                            if stream.write_all(frame.as_bytes()).is_err() {
                                break;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if stream.write_all(b": keep-alive\n\n").is_err() {
                                break;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
            }
            ("POST", "/v1/query") | ("POST", "/v1/action") | ("POST", "/v1/approval") => {
                let request_value = serde_json::from_slice::<Value>(&body).unwrap_or(Value::Null);
                let name = request_value.get("name").and_then(Value::as_str).unwrap_or_default();
                let input = request_value.get("input").cloned().unwrap_or_else(|| json!({}));
                let kind = if path.ends_with("/query") {
                    "query"
                } else if path.ends_with("/action") {
                    "action"
                } else {
                    "approval"
                };
                let payload = handle_bridge_request(&shared, &app, kind, name, &input);
                write_json_response(&mut stream, "200 OK", &payload);
            }
            _ => {
                let payload = json!({ "ok": false, "error": "not_found" });
                write_json_response(&mut stream, "404 Not Found", &payload);
            }
        },
        Err(error) => {
            let payload = json!({ "ok": false, "error": error });
            write_json_response(&mut stream, "400 Bad Request", &payload);
        }
    }
}

fn start_bridge_server(app: &tauri::AppHandle, shared: Arc<Mutex<BridgeRuntime>>) -> Result<BridgeManifest, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("绑定本地 bridge 端口失败: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取本地 bridge 端口失败: {}", e))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("设置本地 bridge 监听器失败: {}", e))?;

    let manifest_path = resolve_bridge_manifest_path()?;
    let base_url = format!("http://127.0.0.1:{}", port);
    let manifest = BridgeManifest {
        version: String::from("0.1.0"),
        transport: String::from("tauri_loopback_http"),
        host: String::from("127.0.0.1"),
        port,
        base_url: base_url.clone(),
        health_url: format!("{}/health", base_url),
        contract_url: format!("{}/v1/contract", base_url),
        events_url: format!("{}/v1/events", base_url),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        updated_at: now_ms(),
    };

    {
        let mut runtime = shared.lock().expect("bridge mutex poisoned");
        runtime.manifest = manifest.clone();
    }
    write_bridge_manifest(&manifest)?;

    let app_handle = app.clone();
    thread::spawn(move || loop {
        match listener.accept() {
            Ok((stream, _addr)) => {
                let shared_clone = Arc::clone(&shared);
                let app_clone = app_handle.clone();
                thread::spawn(move || handle_http_connection(shared_clone, app_clone, stream));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(40));
            }
            Err(_) => break,
        }
    });

    Ok(manifest)
}

#[tauri::command]
fn save_graph_data(data: String) -> Result<String, String> {
    let file_path = resolve_graph_data_path()?;
    std::fs::write(&file_path, &data).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn load_graph_data() -> Result<String, String> {
    let file_path = resolve_graph_data_path()?;
    if !file_path.exists() {
        return Ok(String::from("{}"));
    }
    std::fs::read_to_string(&file_path).map_err(|e| format!("读取文件失败: {}", e))
}

#[tauri::command]
fn get_graph_data_info() -> Result<GraphDataInfo, String> {
    build_current_graph_data_info()
}

#[tauri::command]
fn bridge_status(state: State<BridgeAppState>) -> Result<BridgeStatus, String> {
    let runtime = state.inner.lock().map_err(|_| "bridge 状态已损坏".to_string())?;
    Ok(BridgeStatus {
        enabled: true,
        source: String::from("tauri"),
        manifest: runtime.manifest.clone(),
    })
}

#[tauri::command]
fn bridge_sync_state(state: State<BridgeAppState>, snapshot: Value) -> Result<Value, String> {
    let payload = serde_json::from_value::<BridgeStateSyncPayload>(snapshot)
        .map_err(|e| format!("bridge_sync_state 参数无效: {}", e))?;
    let mut runtime = state.inner.lock().map_err(|_| "bridge 状态已损坏".to_string())?;
    runtime.workspace = payload.workspace;
    runtime.workspace.summary = build_workspace_summary(&runtime.workspace);
    runtime.execution_state = payload.execution_state;
    runtime.contract = payload.contract;
    sync_counters_from_execution(&mut runtime);
    Ok(json!({
        "ok": true,
        "reason": payload.reason,
        "revision": runtime.workspace.revision,
    }))
}

#[tauri::command]
fn bridge_query(app: tauri::AppHandle, state: State<BridgeAppState>, name: String, input: Value) -> Result<Value, String> {
    Ok(handle_bridge_request(&state.inner, &app, "query", &name, &input))
}

#[tauri::command]
fn bridge_action(app: tauri::AppHandle, state: State<BridgeAppState>, name: String, input: Value) -> Result<Value, String> {
    Ok(handle_bridge_request(&state.inner, &app, "action", &name, &input))
}

#[tauri::command]
fn bridge_approval(app: tauri::AppHandle, state: State<BridgeAppState>, name: String, input: Value) -> Result<Value, String> {
    Ok(handle_bridge_request(&state.inner, &app, "approval", &name, &input))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            save_graph_data,
            load_graph_data,
            get_graph_data_info,
            bridge_status,
            bridge_sync_state,
            bridge_query,
            bridge_action,
            bridge_approval
        ])
        .setup(|app| {
            let app_data_dir = resolve_app_data_dir()?;
            let initial_graph = read_graph_data_file();
            let shared = Arc::new(Mutex::new(BridgeRuntime {
                manifest: BridgeManifest {
                    version: String::from("0.1.0"),
                    transport: String::from("tauri_loopback_http"),
                    host: String::from("127.0.0.1"),
                    port: 0,
                    base_url: String::new(),
                    health_url: String::new(),
                    contract_url: String::new(),
                    events_url: String::new(),
                    manifest_path: resolve_bridge_manifest_path()?.to_string_lossy().to_string(),
                    updated_at: now_ms(),
                },
                workspace: create_default_workspace_snapshot(initial_graph),
                execution_state: BridgeExecutionState::default(),
                contract: json!({
                    "version": "0.0.0",
                    "resource": {},
                    "tools": [],
                }),
                session_counter: 1,
                task_counter: 1,
                approval_counter: 1,
                event_counter: 1,
                revision_counter: 1,
                subscribers: Vec::new(),
                app_data_dir,
            }));

            let _manifest = start_bridge_server(&app.handle(), Arc::clone(&shared))?;
            app.manage(BridgeAppState { inner: shared });

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
