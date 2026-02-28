import { execSync } from 'node:child_process';
import chalk from 'chalk';

const COMMIT_MESSAGE_FILE = process.argv[2];
if (!COMMIT_MESSAGE_FILE) {
  console.error(chalk.red('❌ 没有提供 commit message 文件路径'));
  process.exit(1);
}

try {
  execSync(`pnpm exec commitlint --edit ${COMMIT_MESSAGE_FILE}`, {
    stdio: 'inherit',
  });
  console.log(chalk.green('✅ Commitlint 检查通过'));
} catch (error) {
  console.error(
    `${chalk.red('❌ Commitlint 校验失败:')}\n${chalk.yellow(error)}\n${chalk.blue('提示：请确保提交信息符合规范格式')}`,
  );
  process.exit(1);
}
