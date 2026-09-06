import {select , isCancel} from "@clack/prompts";
import chalk from "chalk"
import figlet from "figlet";
import { runCliMode } from "../modes/cli";
import { runTelegramMode } from "../modes/telegram";

const BANNER_FONT = 'ANSI Shadow';
const SHADOW = chalk.hex('#5b4d9e');
const FACE = chalk.hex('#e8dcf8').bold;

function printBannerWithShadow(ascii: string) {

  const bannerLines = ascii.replace(/\s+$/, '').split('\n');
  const maxLen = Math.max(...bannerLines.map((l) => l.length), 0);
  const rowWidth = maxLen + 2;

  for (const line of bannerLines) {
    console.log(SHADOW(('  ' + line).padEnd(rowWidth)));
  }
  process.stdout.write(`\x1b[${bannerLines.length}A`);
  for (const line of bannerLines) {
    console.log(FACE(line.padEnd(rowWidth)));
  }
  console.log();
}



export async function runWakeup() {
    let ascii:string;
    try {
        ascii = figlet.textSync("RifeClaw" , {font:BANNER_FONT})
    } catch (error) {
        ascii = figlet.textSync("RifeClaw" , {font:"Standard"})
    }

    printBannerWithShadow(ascii);

    // Add spacing and context
    console.log();
    console.log(SHADOW(chalk.grey("Choose your preferred interface:")));
    console.log();

    const mode = await select({
        message: "Type a number or arrow keys:\n\n[1] 💻 Command Line Interface (CLI)\n[2] 📌 Telegram Assistant\n[3] 🚪 Exit",
        options:[
            {value:"cli" , label:"💻 Command Line Interface (CLI)"},
            {value:"telegram" , label:"📌 Telegram Assistant"},
            {value:"exit" , label:"🚪 Exit"}
        ]
    });

    if(isCancel(mode) || mode === "exit"){
        console.log(chalk.yellow('\\n Dont worry! Just run `rifeclaw` again.'));
        return;
    }

    // Optional: Add a loading message before switching modes
    console.log('\\nLoading your choice...');
    console.log();

    if(mode === "cli"){
        await runCliMode()
    }
    else if(mode === "telegram"){
        await runTelegramMode()
    }
}
