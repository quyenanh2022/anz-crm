#!/usr/bin/env python3
"""Seller Network (artifact) -> bản web GitHub Pages + Supabase.
Dùng: python3 build.py <sn-artifact.html> <out/index.html>"""
import sys, re, pathlib
src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
shim = open(pathlib.Path(__file__).with_name("shim.js"), encoding="utf-8").read()

# 1) runtime: supabase-js + shim, chèn trước script chính của SN
anchor = '<script>\n(function(){\n  "use strict";\n  const SC="sellers"'
assert s.count(anchor) == 1, "không tìm thấy script chính SN"
inj = ('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>\n'
       '<script>\n' + shim + '\n</script>\n')
s = s.replace(anchor, inj + anchor)

# 2) file đính kèm / logo: /_blob/<id> của artifact -> Supabase Storage
s = s.replace('src="/_blob/${', 'src="${SN_BLOB}${')
s = s.replace('"/_blob/"+', 'SN_BLOB+').replace("'/_blob/'+", 'SN_BLOB+')
assert "/_blob/" not in s, "còn /_blob/ chưa đổi"

# 3) quyền ATS theo cấp: admin dùng mã quản trị chung; Trưởng nhóm / Nhân viên mở ATS bằng
#    bản "đăng nhập Google" (vai trò lấy từ tab Thành viên của sheet) → không lộ mã quản trị.
#    Nhân viên không mở Google Sheet gốc (link Sheet → web ATS), Trưởng nhóm thì được.
ATS_G = "https://script.google.com/macros/s/AKfycbxRy8oq8N0IAfwSU6Z60U0XG-JNOKXloIs94tLxBIqzvKNq6U6sIIhZpDrAiVOiRqd9MA/exec"
a1 = 'function atsSheetLink(s){return s.atsSheetUrl||'
assert s.count(a1) == 1
s = s.replace(a1, 'function atsSheetLink(s){if(window.__snMe&&window.__snMe.level==="staff")return "' + ATS_G + '?p="+encodeURIComponent(s.atsSheetId);return s.atsSheetUrl||')
a2 = 'async function openAtsWebApp(id,fallback){\n    const s=sellerById(id)||fallback;if(!s)return;\n    if(!s.atsSheetId){confirmCreateAts(s);return;}\n'
assert s.count(a2) == 1, "openAtsWebApp"
s = s.replace(a2, a2 + '    if(window.__snMe&&window.__snMe.level!=="admin"){window.open("' + ATS_G + '?p="+encodeURIComponent(s.atsSheetId),"_blank");return;}\n')

# 4) câu chữ nhắc claude.ai
rep = {
  "Chưa kết nối Google Drive trong claude.ai (Settings → Connectors)": "Chưa kết nối được Google Drive",
  "Chưa kết nối Google Drive trong claude.ai": "Chưa kết nối được Google Drive",
  "Chưa kết nối Google Drive. Vào claude.ai → Settings → Connectors để thêm.": "Chưa kết nối được Google Drive — báo admin kiểm tra.",
  "Kết nối Google Drive hết hạn, hãy kết nối lại trong claude.ai → Settings → Connectors.": "Kết nối Google Drive lỗi — tải lại trang.",
  "Chưa kết nối kho dữ liệu — hãy mở app trên claude.ai (đã đăng nhập)": "Chưa kết nối kho dữ liệu — đăng nhập lại",
  "Kiểm tra Google Drive đã kết nối trong claude.ai.": "Thử tải lại trang.",
}
for a, b in rep.items(): s = s.replace(a, b)
s = s.replace("<title>", "<title>", 1)
if "<title>" not in s:
    s = s.replace("<head>", "<head><title>Seller Network · ANZ</title>", 1)
pathlib.Path(out).parent.mkdir(parents=True, exist_ok=True)
open(out, "w", encoding="utf-8").write(s)
print("ok", len(s), "claude.ai còn:", s.count("claude.ai"))
