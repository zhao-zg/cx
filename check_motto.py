from docx import Document

doc = Document('resource/2025-04 夏季训练/经文.docx')

print("前100行内容：")
for i, p in enumerate(doc.paragraphs[:100]):
    text = p.text.strip()
    if text:
        print(f"{i}: |{text}|")

