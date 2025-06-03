import imaplib
import smtplib
import email
from email.message import EmailMessage
from email.header import decode_header
from openai import OpenAI
from config import *

client = OpenAI(api_key=OPENAI_API_KEY)

def decode_mime_header(header):
    """解码MIME编码的邮件头"""
    if not header:
        return ""
    
    decoded_parts = decode_header(header)
    result = []
    
    for part, encoding in decoded_parts:
        if isinstance(part, bytes):
            part = part.decode(encoding or 'utf-8', errors='ignore')
        result.append(str(part))
    
    return ''.join(result)

def check_new_emails():
    # 登录 iCloud IMAP（使用主邮箱地址）
    mail = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
    mail.login(ICLOUD_LOGIN_EMAIL, ICLOUD_APP_PASSWORD)
    mail.select("inbox")

    # 获取未读邮件
    status, messages = mail.search(None, '(UNSEEN)')
    
    # 检查是否有邮件
    if status != 'OK' or not messages[0]:
        print("📭 暂无新邮件")
        mail.logout()
        return
    
    for num in messages[0].split():
        # 使用BODY[]获取完整的邮件内容
        status, data = mail.fetch(num, '(BODY[])')
        
        # 检查获取是否成功
        if status != 'OK' or not data or len(data) == 0:
            print(f"⚠️  无法获取邮件 {num}，跳过")
            continue
            
        # 获取邮件原始数据
        if isinstance(data[0], tuple) and len(data[0]) > 1:
            raw_email = data[0][1]
        else:
            print(f"⚠️  邮件 {num} 数据格式异常，跳过")
            continue
            
        # 确保是字节串
        if not isinstance(raw_email, bytes):
            print(f"⚠️  邮件 {num} 不是字节格式，跳过")
            continue

        msg = email.message_from_bytes(raw_email)

        sender = email.utils.parseaddr(msg["From"])[1]
        subject = decode_mime_header(msg["Subject"]) or "(无主题)"
        body = get_email_body(msg)

        print(f"📩 收到来自 {sender} 的提示词：标题｜{subject}｜，内容｜{body.strip()}｜")

        reply_text = ask_gpt(body)
        print(f"🤖 回复：{reply_text}")
        send_reply(sender, subject, reply_text)

    mail.logout()

def get_email_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and part.get_content_disposition() is None:
                return part.get_payload(decode=True).decode(errors="ignore")
    else:
        return msg.get_payload(decode=True).decode(errors="ignore")
    return ""

def ask_gpt(prompt):
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content.strip()

def send_reply(to_addr, original_subject, reply_text):
    msg = EmailMessage()
    msg["Subject"] = "Re: " + original_subject
    msg["From"] = f"MailGPT <{CUSTOM_FROM_EMAIL}>"
    msg["To"] = to_addr
    msg.set_content(reply_text)

    with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
        server.starttls()
        server.login(ICLOUD_LOGIN_EMAIL, ICLOUD_APP_PASSWORD)
        server.send_message(msg)

    print(f"✅ 回复已发送给 {to_addr}")

if __name__ == "__main__":
    check_new_emails()
