#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LibreOffice 自动安装脚本
支持 Windows、macOS 和 Linux
"""

import os
import sys
import platform
import subprocess
import urllib.request
import tempfile
import shutil

def check_libreoffice_installed():
    """检查 LibreOffice 是否已安装"""
    soffice_commands = [
        'soffice',
        'libreoffice',
        r'C:\Program Files\LibreOffice\program\soffice.exe',
        r'C:\Program Files (x86)\LibreOffice\program\soffice.exe',
    ]
    
    for cmd in soffice_commands:
        if shutil.which(cmd) or os.path.exists(cmd):
            print(f"✓ LibreOffice 已安装: {cmd}")
            return True
    
    return False

def install_windows():
    """在 Windows 上安装 LibreOffice"""
    print("\n正在为 Windows 安装 LibreOffice...")
    print("=" * 60)
    
    # 使用 winget（Windows 10/11 自带）
    print("\n尝试使用 winget 安装...")
    print("提示: LibreOffice 大小约 348MB，下载可能需要较长时间...")
    print("如果下载速度慢，建议按 Ctrl+C 取消，然后手动安装")
    try:
        result = subprocess.run(
            ['winget', 'install', '--id', 'TheDocumentFoundation.LibreOffice', '--silent', '--accept-package-agreements', '--accept-source-agreements'],
            text=True,
            timeout=900  # 15分钟超时
        )
        
        if result.returncode == 0:
            print("✓ LibreOffice 安装成功！")
            return True
        else:
            print(f"✗ winget 安装失败")
    except FileNotFoundError:
        print("✗ winget 未找到")
    except subprocess.TimeoutExpired:
        print("✗ winget 安装超时（15分钟）")
        print("  可能是网络速度较慢，建议手动安装")
    except KeyboardInterrupt:
        print("\n✗ 用户取消安装")
        raise
    except Exception as e:
        print(f"✗ winget 安装出错: {e}")
    
    # 备选方案：使用 Chocolatey
    print("\n尝试使用 Chocolatey 安装...")
    try:
        result = subprocess.run(
            ['choco', 'install', 'libreoffice-fresh', '-y'],
            capture_output=True,
            text=True,
            timeout=600
        )
        
        if result.returncode == 0:
            print("✓ LibreOffice 安装成功！")
            return True
        else:
            print(f"✗ Chocolatey 安装失败: {result.stderr}")
    except FileNotFoundError:
        print("✗ Chocolatey 未找到")
    except Exception as e:
        print(f"✗ Chocolatey 安装出错: {e}")
    
    # 手动下载安装
    print("\n" + "=" * 60)
    print("自动安装失败，请手动安装：")
    print("\n方法 1: 使用 winget（推荐）")
    print("  在命令提示符或 PowerShell 中运行：")
    print("  winget install TheDocumentFoundation.LibreOffice")
    print("\n方法 2: 手动下载")
    print("  1. 访问: https://www.libreoffice.org/download/download/")
    print("  2. 下载 Windows 版本")
    print("  3. 运行安装程序")
    print("=" * 60)
    
    return False

def install_macos():
    """在 macOS 上安装 LibreOffice"""
    print("\n正在为 macOS 安装 LibreOffice...")
    print("=" * 60)
    
    # 使用 Homebrew
    print("\n尝试使用 Homebrew 安装...")
    try:
        # 检查 Homebrew 是否安装
        subprocess.run(['brew', '--version'], capture_output=True, check=True)
        
        print("正在安装 LibreOffice（这可能需要几分钟）...")
        result = subprocess.run(
            ['brew', 'install', '--cask', 'libreoffice'],
            capture_output=True,
            text=True,
            timeout=600
        )
        
        if result.returncode == 0:
            print("✓ LibreOffice 安装成功！")
            return True
        else:
            print(f"✗ Homebrew 安装失败: {result.stderr}")
    except FileNotFoundError:
        print("✗ Homebrew 未安装")
        print("\n请先安装 Homebrew:")
        print("  /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"")
    except Exception as e:
        print(f"✗ Homebrew 安装出错: {e}")
    
    # 手动下载安装
    print("\n" + "=" * 60)
    print("自动安装失败，请手动安装：")
    print("\n方法 1: 使用 Homebrew（推荐）")
    print("  brew install --cask libreoffice")
    print("\n方法 2: 手动下载")
    print("  1. 访问: https://www.libreoffice.org/download/download/")
    print("  2. 下载 macOS 版本")
    print("  3. 拖动到应用程序文件夹")
    print("=" * 60)
    
    return False

def install_linux():
    """在 Linux 上安装 LibreOffice"""
    print("\n正在为 Linux 安装 LibreOffice...")
    print("=" * 60)
    
    # 检测发行版
    distro = None
    try:
        with open('/etc/os-release', 'r') as f:
            for line in f:
                if line.startswith('ID='):
                    distro = line.split('=')[1].strip().strip('"')
                    break
    except:
        pass
    
    print(f"检测到发行版: {distro or '未知'}")
    
    # Ubuntu/Debian
    if distro in ['ubuntu', 'debian', 'linuxmint']:
        print("\n使用 apt 安装...")
        try:
            subprocess.run(['sudo', 'apt', 'update'], check=True)
            subprocess.run(['sudo', 'apt', 'install', '-y', 'libreoffice'], check=True)
            print("✓ LibreOffice 安装成功！")
            return True
        except Exception as e:
            print(f"✗ apt 安装失败: {e}")
    
    # Fedora/RHEL/CentOS
    elif distro in ['fedora', 'rhel', 'centos']:
        print("\n使用 dnf/yum 安装...")
        try:
            subprocess.run(['sudo', 'dnf', 'install', '-y', 'libreoffice'], check=True)
            print("✓ LibreOffice 安装成功！")
            return True
        except:
            try:
                subprocess.run(['sudo', 'yum', 'install', '-y', 'libreoffice'], check=True)
                print("✓ LibreOffice 安装成功！")
                return True
            except Exception as e:
                print(f"✗ yum 安装失败: {e}")
    
    # Arch Linux
    elif distro in ['arch', 'manjaro']:
        print("\n使用 pacman 安装...")
        try:
            subprocess.run(['sudo', 'pacman', '-S', '--noconfirm', 'libreoffice-fresh'], check=True)
            print("✓ LibreOffice 安装成功！")
            return True
        except Exception as e:
            print(f"✗ pacman 安装失败: {e}")
    
    # 通用方案
    print("\n" + "=" * 60)
    print("请根据您的发行版手动安装：")
    print("\nUbuntu/Debian:")
    print("  sudo apt update && sudo apt install libreoffice")
    print("\nFedora:")
    print("  sudo dnf install libreoffice")
    print("\nArch Linux:")
    print("  sudo pacman -S libreoffice-fresh")
    print("=" * 60)
    
    return False

def main():
    print("=" * 60)
    print("LibreOffice 自动安装工具")
    print("=" * 60)
    
    # 检查是否已安装
    if check_libreoffice_installed():
        print("\nLibreOffice 已经安装，无需重复安装。")
        return 0
    
    print("\n未检测到 LibreOffice，开始安装...")
    
    # 根据操作系统选择安装方法
    system = platform.system()
    success = False
    
    if system == 'Windows':
        success = install_windows()
    elif system == 'Darwin':
        success = install_macos()
    elif system == 'Linux':
        success = install_linux()
    else:
        print(f"\n✗ 不支持的操作系统: {system}")
        return 1
    
    if success:
        print("\n" + "=" * 60)
        print("✓ 安装完成！")
        print("请重新运行 main.py 来处理文档。")
        print("=" * 60)
        return 0
    else:
        print("\n" + "=" * 60)
        print("✗ 自动安装失败")
        print("请按照上述说明手动安装 LibreOffice")
        print("安装完成后，重新运行 main.py")
        print("=" * 60)
        return 1

if __name__ == '__main__':
    sys.exit(main())
