# เอา PyLens ขึ้นออนไลน์

PyLens เป็นเว็บแบบ static (ไม่มีโค้ดฝั่งเซิร์ฟเวอร์ ไม่มีฐานข้อมูล ไม่มี API key) โฮสต์ฟรีได้ทุกที่

## ก่อนอัปโหลด: เช็คในเครื่อง

```bash
python -m http.server 8765
```

เปิด http://localhost:8765/index.html และ http://localhost:8765/tests/index.html (ชื่อแท็บควรเป็น `PASS ...`)

## GitHub Pages (ฟรี)

1. สร้าง repo ใหม่ใน GitHub (Public) แล้วอัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้
   - ผ่านหน้าเว็บ: **Add file → Upload files** แล้วลากไฟล์/โฟลเดอร์ใส่ (อย่าลืม `.github`)
   - หรือผ่านคำสั่ง `git init -b main`, `git add .`, `git commit -m "PyLens"`, `git remote add origin <url>`, `git push -u origin main`
2. **Settings → Pages → Source: GitHub Actions**
3. ดูแท็บ **Actions** รอให้งาน "Deploy to GitHub Pages" เสร็จ
4. เว็บอยู่ที่ `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repo>/`

> ถ้าอัปโหลด `.github` ผ่านหน้าเว็บไม่ได้ ให้ **Add file → Create new file** ตั้งชื่อ `.github/workflows/pages.yml` แล้ววางเนื้อหาจากไฟล์ในโฟลเดอร์นี้

## Netlify / Cloudflare Pages / Vercel (ฟรี)

1. สร้างเว็บใหม่ แล้วลากโฟลเดอร์นี้ใส่ (Netlify Drop) หรือเชื่อมกับ repo
2. Build command: ไม่ต้องมี — Publish directory: `.`

## โฮสต์อื่น

อัปโหลดทั้งโฟลเดอร์ตามโครงสร้างเดิม ใช้ได้กับ static hosting ทั่วไป

## หลังเผยแพร่

- ลิงก์แชร์ที่สร้างจากปุ่ม **แชร์ลิงก์** (`#d=...`) มีโค้ดอยู่ใน URL ใช้ได้ทุกโฮสต์
- ต้องมีอินเทอร์เน็ตตอนเปิดเว็บ เพราะโหลดตัวรัน Python และไลบรารีจาก CDN
- อัปเดตเว็บ: อัปโหลด/push ไฟล์ใหม่ เว็บจะอัปเดตเอง
- รูปน้องงูใน `assets/`: ตรวจให้แน่ใจว่ามีสิทธิ์เผยแพร่ภาพนี้
