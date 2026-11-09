import { common } from '@kit.AbilityKit';
import { buffer } from '@kit.ArkTS';
import webview from '@ohos.web.webview';
import entry from 'libentry.so';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  @State ready: boolean = false;
  @State message: string = '正在后台线程加载 libnode.so…';

  aboutToAppear(): void {
    const context = getContext(this) as common.UIAbilityContext;
    const root = context.filesDir + '/engine';
    const started = entry.startNode(root, 3080);
    if (!started) {
      this.message = 'libnode.so 或 node::Start 不可用，请先按 README 放置 arm64 库。';
      return;
    }
    this.message = 'Node 已在独立线程启动，等待 127.0.0.1:3080…';
    setTimeout(() => {
      this.ready = true;
    }, 8000);
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
      if (this.ready) {
        Web({ src: 'http://127.0.0.1:3080/', controller: this.controller })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .fileAccess(true)
          .backgroundColor('#0A0A0A')
          .onPageEnd(() => {
            this.injectAssets();
          })
      } else {
        Column({ space: 18 }) {
          Image($r('app.media.icon'))
            .width(96)
            .height(96)
          Text('DeepSeek Harness')
            .fontSize(24)
            .fontWeight(FontWeight.Medium)
            .fontColor('#FFFFFF')
          Text(this.message)
            .fontSize(14)
            .fontColor('#9AA3B2')
            .textAlign(TextAlign.Center)
            .padding({ left: 32, right: 32 })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0A0A0A')
  }
}
