# Seller Network – bản web (ANZ)

https://quyenanh2022.github.io/anz-crm/ — đăng nhập Google, dữ liệu trên Supabase (bảng `sn_docs`).

- `index.html` = Seller Network build từ bản artifact bằng `tools/build.py` + `tools/shim.js`
  (`python3 tools/build.py <sn-artifact.html> index.html`).
- shim giả lập `claude.use("db" | "mcp" | "downloads" | "assets")`:
  db → Supabase `sn_docs` (RLS), Google Drive → Edge Function `sn-drive` → Apps Script ATS (`SnProxy.gs`, doPost).
- `crm-v1.html` = bản CRM thử nghiệm đầu tiên (không dùng).
