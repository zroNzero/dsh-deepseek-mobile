import { common } from '@kit.AbilityKit';
import { buffer } from '@kit.ArkTS';
import { fileIo as fs } from '@kit.CoreFileKit';
import webview from '@ohos.web.webview';
import entry from 'libentry.so';

interface GhConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private nodeStarted: boolean = false;

  @State ready: boolean = false;
  @State webUrl: string = '';
  @State message: string = '准备中';
  @State showConfig: boolean = true;
  @State tokenInput: string = '';
  @State repoInput: string = '';
  @State branchInput: string = 'main';
  @State configMessage: string = '';

  aboutToAppear(): void {
    this.prepare();
  }

  private async copyRaw(context: common.UIAbilityContext, name: string, dest: string): Promise<void> {
    const data = await context.resourceManager.getRawFileContent(name);
    const file = fs.openSync(dest, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    const chunkSize = 4 * 1024 * 1024;
    let offset = 0;
    while (offset < data.byteLength) {
      const end = Math.min(offset + chunkSize, data.byteLength);
      const chunk = data.buffer.slice(data.byteOffset + offset, data.byteOffset + end);
      const written = fs.writeSync(file.fd, chunk, { length: chunk.byteLength });
      if (written <= 0) break;
      offset += written;
    }
    fs.closeSync(file.fd);
    if (offset !== data.byteLength) {
      throw new Error(`short write ${offset}/${data.byteLength}`);
    }
  }

  private ensureDir(path: string): void {
    try {
      fs.mkdirSync(path, true);
    } catch (_e) {
      // EEXIST is expected on every launch after the first.
    }
  }

  private readConfig(path: string): GhConfig | null {
    try {
      if (!fs.accessSync(path)) return null;
      const parsed = JSON.parse(fs.readTextSync(path)) as GhConfig;
      if (parsed && parsed.token && parsed.owner && parsed.repo) return parsed;
    } catch (_e) {
      return null;
    }
    return null;
  }

  private async prepare(): Promise<void> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const cfg = this.readConfig(context.filesDir + '/engine/cloud-github.json');
    if (cfg !== null) {
      this.branchInput = cfg.branch.length > 0 ? cfg.branch : 'main';
      this.showConfig = false;
      await this.bootstrap();
      return;
    }
    this.showConfig = true;
    this.message = '配置 Token';
  }

  private async ensureRuntime(context: common.UIAbilityContext): Promise<boolean> {
    const engine = context.filesDir + '/engine';
    const entryPath = engine + '/lib/node_modules/@deepseek-ai/dsh/lib/bin.js';
    const pluginDir = engine + '/lib/node_modules';

    try {
      this.ensureDir(engine);
      this.ensureDir(pluginDir);
      // Copy the local GitHub plugin on every launch so an app update replaces
      // it without needing a runtime package manager (pnpm is unavailable).
      await this.copyRaw(context, 'cloud-github.mjs', pluginDir + '/cloud-github.mjs');

      // The bootstrap is tiny and must track the HAP even when the runtime was
      // extracted by an older build; otherwise a new --patch/plugin never runs.
      await this.copyRaw(context, 'bootstrap.cjs', engine + '/bootstrap.cjs');

      if (fs.accessSync(entryPath)) return true;

      await this.copyRaw(context, 'runtime-js.tar.gz', engine + '/runtime-js.tar.gz');
      console.info('[DSH] payload and cloud-github plugin staged');
      return true;
    } catch (e) {
      console.error(`[DSH] runtime prepare failed: ${JSON.stringify(e)}`);
      return false;
    }
  }

  private async bootstrap(): Promise<void> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const prepared = await this.ensureRuntime(context);
    if (!prepared) {
      this.message = '运行时就绪失败';
      return;
    }

    this.message = '启动中';
    const started = entry.startNode(context.filesDir + '/engine', 3080);
    if (!started) {
      this.message = '启动失败';
      return;
    }
    this.nodeStarted = true;
    this.message = '等待服务';
    this.waitForUrl();
  }

  private waitForUrl(): void {
    const timer: number = setInterval(() => {
      const url: string = entry.getWebUrl();
      if (url.length > 0) {
        clearInterval(timer);
        this.webUrl = url;
        this.ready = true;
      }
    }, 1000);
    setTimeout(() => {
      clearInterval(timer);
    }, 120000);
  }

  private async saveConfig(): Promise<void> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const token = this.tokenInput.trim();
    let value = this.repoInput.trim();
    if (value.startsWith('https://github.com/')) value = value.substring('https://github.com/'.length);
    if (value.startsWith('http://github.com/')) value = value.substring('http://github.com/'.length);
    if (value.endsWith('/')) value = value.substring(0, value.length - 1);
    if (value.endsWith('.git')) value = value.substring(0, value.length - 4);
    const parts = value.split('/').filter((part: string) => part.length > 0);
    if (token.length === 0 || parts.length < 2) {
      this.configMessage = '参数缺失';
      return;
    }

    const config: GhConfig = {
      token,
      owner: parts[0],
      repo: parts[1],
      branch: this.branchInput.trim().length > 0 ? this.branchInput.trim() : 'main',
    };

    try {
      const engine = context.filesDir + '/engine';
      this.ensureDir(engine);
      const file = fs.openSync(engine + '/cloud-github.json',
        fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      fs.writeSync(file.fd, JSON.stringify(config));
      fs.closeSync(file.fd);
      this.showConfig = false;
      this.configMessage = '';
      if (!this.nodeStarted) {
        await this.bootstrap();
      }
    } catch (e) {
      this.configMessage = '保存失败';
    }
  }

  private async injectAssets(): Promise<void> {
    try {
      const manager = getContext(this).resourceManager;
      const jsData = await manager.getRawFileContent('inject.js');
      const cssData = await manager.getRawFileContent('inject.css');
      const js = buffer.from(jsData).toString('utf-8');
      const css = buffer.from(cssData).toString('utf-8');

      await this.controller.runJavaScript(js);
      const cssScript = `(function(){var id='ds-inject-style';var s=document.getElementById(id);` +
        `if(!s){s=document.createElement('style');s.id=id;(document.head||document.documentElement).appendChild(s);}` +
        `s.textContent=${JSON.stringify(css)};})()`;
      await this.controller.runJavaScript(cssScript);
    } catch (_e) {
      // The host remains usable even if a resource is missing.
    }
  }

  build() {
    Stack() {
      if (this.showConfig) {
        Column({ space: 10 }) {
          Image($r('app.media.icon')).width(72).height(72)
          Text('GitHub').fontSize(24).fontWeight(FontWeight.Medium).fontColor('#FFFFFF')

          TextInput({ placeholder: 'GitHub Token' })
            .type(InputType.Password)
            .width('88%').height(44)
            .backgroundColor('#141414').fontColor('#FFFFFF').placeholderColor('#777777')
            .onChange((value: string) => { this.tokenInput = value; })

          TextInput({ placeholder: 'owner/repo' })
            .width('88%').height(44)
            .backgroundColor('#141414').fontColor('#FFFFFF').placeholderColor('#777777')
            .onChange((value: string) => { this.repoInput = value; })

          TextInput({ placeholder: '分支' })
            .width('88%').height(44)
            .backgroundColor('#141414').fontColor('#FFFFFF').placeholderColor('#777777')
            .onChange((value: string) => { this.branchInput = value; })

          Button('保存')
            .width('88%').height(44)
            .backgroundColor('#4D6BFE').fontColor('#FFFFFF')
            .onClick(() => { this.saveConfig(); })

          Text(this.configMessage).fontSize(12).fontColor('#FF6B6B')
            .textAlign(TextAlign.Center).padding({ left: 24, right: 24 })
        }
        .width('100%').height('100%').justifyContent(FlexAlign.Center)
      } else if (this.ready && this.webUrl.length > 0) {
        Web({ src: this.webUrl, controller: this.controller })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .fileAccess(true)
          .backgroundColor('#0A0A0A')
          .onPageEnd(() => {
            this.injectAssets();
          })
      } else {
        Column({ space: 18 }) {
          Image($r('app.media.icon')).width(96).height(96)
          Text('DeepSeek Harness').fontSize(24).fontWeight(FontWeight.Medium).fontColor('#FFFFFF')
          Text(this.message).fontSize(14).fontColor('#9AA3B2')
            .textAlign(TextAlign.Center).padding({ left: 32, right: 32 })
        }
        .width('100%').height('100%').justifyContent(FlexAlign.Center)
      }
    }
    .width('100%').height('100%').backgroundColor('#0A0A0A')
  }
}
