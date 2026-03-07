import { spawn } from 'child_process';

const isDev = process.env.NODE_ENV === 'development';
const command = isDev ? 'dev' : 'start';

const port = process.env.PORT || '5000';
const next = spawn('npx', ['next', command, '-p', port, '-H', '0.0.0.0'], {
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
