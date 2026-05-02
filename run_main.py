import subprocess, sys
result = subprocess.run(['python', 'main.py'], capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=r'G:\project\go\cx')
output = result.stdout + result.stderr
# Find failure
for i, line in enumerate(output.split('\n')):
    if 'Ê§°Ü' in line or 'ERR' in line or 'Error' in line.lower() or '?' in line:
        start = max(0, i-2)
        end = min(len(output.split('\n')), i+5)
        print('\n'.join(output.split('\n')[start:end]))
        print('---')
print('Exit:', result.returncode)
