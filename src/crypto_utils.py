# -*- coding: utf-8 -*-
"""
内容加密/解密工具
用于保护 HTML 内容不被直接读取
"""
import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2


class ContentEncryptor:
    """内容加密器"""
    
    def __init__(self, password: str = None):
        """
        初始化加密器
        
        Args:
            password: 加密密码，如果不提供则使用默认密钥
        """
        if password:
            # 使用密码派生密钥
            salt = b'cx_special_salt_2026'  # 固定盐值
            kdf = PBKDF2(
                algorithm=hashes.SHA256(),
                length=32,
                salt=salt,
                iterations=100000,
            )
            key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
        else:
            # 使用默认密钥（仅作示例，生产环境应使用环境变量）
            key = b'cx_tehui_2026_secret_key_for_content_protection_v1=='
        
        self.cipher = Fernet(key)
    
    def encrypt_content(self, content: str) -> str:
        """
        加密内容
        
        Args:
            content: 要加密的内容
            
        Returns:
            加密后的 base64 字符串
        """
        encrypted = self.cipher.encrypt(content.encode('utf-8'))
        return base64.b64encode(encrypted).decode('utf-8')
    
    def decrypt_content(self, encrypted_content: str) -> str:
        """
        解密内容
        
        Args:
            encrypted_content: 加密的 base64 字符串
            
        Returns:
            解密后的内容
        """
        encrypted = base64.b64decode(encrypted_content.encode('utf-8'))
        return self.cipher.decrypt(encrypted).decode('utf-8')
    
    def encrypt_html_section(self, html_content: str, start_marker: str, end_marker: str) -> str:
        """
        加密 HTML 中特定部分
        
        Args:
            html_content: HTML 内容
            start_marker: 开始标记
            end_marker: 结束标记
            
        Returns:
            处理后的 HTML
        """
        start_idx = html_content.find(start_marker)
        end_idx = html_content.find(end_marker)
        
        if start_idx == -1 or end_idx == -1:
            return html_content
        
        # 提取需要加密的部分
        section_start = start_idx + len(start_marker)
        section_to_encrypt = html_content[section_start:end_idx]
        
        # 加密
        encrypted = self.encrypt_content(section_to_encrypt)
        
        # 构建新的 HTML
        before = html_content[:start_idx]
        after = html_content[end_idx + len(end_marker):]
        
        encrypted_div = f'''
    <!-- 加密内容 -->
    <div id="encrypted-content" style="display:none;" data-encrypted="{encrypted}"></div>
    <div id="content-container"></div>
    <script>
    (function() {{
        try {{
            var encDiv = document.getElementById('encrypted-content');
            var container = document.getElementById('content-container');
            var encrypted = encDiv.getAttribute('data-encrypted');
            // 解密逻辑在独立的 decrypt.js 中
            if (window.CXDecrypt) {{
                container.innerHTML = window.CXDecrypt.decrypt(encrypted);
            }} else {{
                container.innerHTML = '<p style="color:red;text-align:center;">内容加载失败</p>';
            }}
        }} catch(e) {{
            console.error('解密失败:', e);
        }}
    }})();
    </script>
'''
        
        return before + start_marker + encrypted_div + end_marker + after


def generate_decrypt_js(password: str = None) -> str:
    """
    生成前端解密 JS 代码
    
    Args:
        password: 加密密码
        
    Returns:
        解密 JS 代码
    """
    # 注意：这里使用简化的 XOR 加密而非 Fernet，因为 Fernet 需要大型库
    # 实际生产中应该使用更安全的方案或将解密逻辑做混淆
    
    return '''
/**
 * 内容解密模块
 * 使用简化的异或加密
 */
(function() {
    'use strict';
    
    var key = 'cx_2026_protection_key';
    
    function xorDecrypt(encrypted, key) {
        var decrypted = '';
        var keyLen = key.length;
        for (var i = 0; i < encrypted.length; i++) {
            decrypted += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % keyLen));
        }
        return decrypted;
    }
    
    function base64Decode(str) {
        return atob(str);
    }
    
    window.CXDecrypt = {
        decrypt: function(encryptedBase64) {
            try {
                var encrypted = base64Decode(encryptedBase64);
                var decrypted = xorDecrypt(encrypted, key);
                return decrypted;
            } catch(e) {
                console.error('解密错误:', e);
                return '<p>内容加载失败</p>';
            }
        }
    };
})();
'''


def simple_xor_encrypt(content: str, key: str = 'cx_2026_protection_key') -> str:
    """
    简单的 XOR 加密（用于前端可解密的场景）
    
    Args:
        content: 要加密的内容
        key: 加密密钥
        
    Returns:
        加密后的 base64 字符串
    """
    encrypted = ''
    key_len = len(key)
    for i, char in enumerate(content):
        encrypted += chr(ord(char) ^ ord(key[i % key_len]))
    return base64.b64encode(encrypted.encode('latin-1')).decode('utf-8')
