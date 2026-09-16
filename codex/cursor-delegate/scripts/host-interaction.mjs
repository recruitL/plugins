import { randomUUID } from "node:crypto";

// Transport diagnostic only. This module has no reference to Bridge or Cursor,
// and NO response from it may be used as execution authority.
export class HostInteractionProbe {
  constructor(send, timeoutMs = 45000) {
    this.send = send;
    this.timeoutMs = timeoutMs;
    this.protocol = "2024-11-05";
    this.supported = false;
    this.pending = null;
    this.last = null;
  }
  configure(params = {}) {
    const supportedVersions = [
      "2024-11-05",
      "2025-03-26",
      "2025-06-18",
      "2025-11-25",
    ];
    this.protocol = supportedVersions.includes(params.protocolVersion)
      ? params.protocolVersion
      : "2025-06-18";
    const e = params.capabilities?.elicitation;
    const object = (v) =>
      v !== null && typeof v === "object" && !Array.isArray(v);
    this.supported =
      object(e) && (object(e.form) || Object.keys(e).length === 0);
    return this.protocol;
  }
  status() {
    return {
      protocol_version: this.protocol,
      form_capability_advertised: this.supported,
      pending: Boolean(this.pending),
      last_result: this.last,
      grants_permissions: false,
      human_identity_verified: false,
    };
  }
  finish(result) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    this.last = {
      ...result,
      grants_permissions: false,
      human_identity_verified: false,
    };
    p.resolve(this.status());
  }
  receive(message) {
    if (!this.pending || message.method || message.id !== this.pending.id)
      return false;
    if (message.error)
      this.finish({
        outcome: "host_error",
        error_code: message.error.code ?? null,
      });
    else if (["accept", "decline", "cancel"].includes(message.result?.action)) {
      this.finish({
        outcome: "host_response",
        action: message.result.action,
        probe_checkbox: message.result.content?.probe_only === true,
        note: "Transport response only. This does not prove a human saw or answered a dialog.",
      });
    } else this.finish({ outcome: "invalid_response" });
    return true;
  }
  cancel(reason = "connection_closed") {
    if (!this.pending) return;
    this.send({
      method: "notifications/cancelled",
      params: { requestId: this.pending.id, reason },
    });
    this.finish({ outcome: reason });
  }
  async run() {
    if (!this.supported)
      return {
        ...this.status(),
        outcome: "unsupported",
        note: "Host did not advertise form elicitation. No request sent.",
      };
    if (this.pending)
      throw Error("Host interaction probe already pending; do not duplicate");
    const id = `host-probe-${randomUUID()}`;
    return await new Promise((resolve) => {
      this.pending = {
        id,
        resolve,
        timer: setTimeout(() => this.cancel("timeout"), this.timeoutMs),
      };
      this.send({
        id,
        method: "elicitation/create",
        params: {
          mode: "form",
          message:
            "Cursor Delegate 无副作用弹窗测试：请亲手选择“拒绝/取消”。本次不启动 Cursor、不读取项目、不授予任何权限。即使选择接受，也不会放行任何操作。请返回任务确认你是否实际看到了此弹窗。",
          requestedSchema: {
            type: "object",
            properties: {
              probe_only: {
                type: "boolean",
                title: "仅确认看到测试弹窗，不授予权限",
              },
            },
            required: ["probe_only"],
          },
        },
      });
    });
  }
}
