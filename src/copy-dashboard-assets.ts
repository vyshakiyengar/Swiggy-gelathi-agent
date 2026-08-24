import { cp, mkdir } from 'fs/promises';
import path from 'path';

async function copyDashboardAssets(): Promise<void> {
  const source = path.resolve(process.cwd(), 'src/dashboard/public');
  const destination = path.resolve(process.cwd(), 'dist/dashboard/public');

  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

copyDashboardAssets().catch((error: unknown) => {
  console.error(
    'Failed to copy dashboard assets:',
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
