import { spawn } from 'child_process';

const next = spawn('npx', ['next', 'dev', '-p', '5000', '-H', '0.0.0.0'], {
  stdio: 'inherit',
  shell: true,
});

next.on('close', (code) => {
  process.exit(code ?? 0);
});

next.on('error', (err) => {
  console.error('Failed to start Next.js:', err);
  process.exit(1);
});
