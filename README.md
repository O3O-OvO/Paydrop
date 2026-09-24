# Paydrop
You work and you get paid per sec.

薪动是一款 Windows 桌面记薪挂件，按日薪与工作时段实时展示收入、秒薪、下班倒计时和已工作时长。支持多段无薪休息、三种主题及自定义透明度。

## 安装与更新

从本仓库 Releases 下载最新版 `Paydrop-Setup-*-x64.exe`，安装后应用会自动检查并下载新版本。更新准备好时，可点击挂件上的重启图标完成安装；退出应用也会安装已下载的更新。旧便携版需要手动安装一次安装版才能加入自动更新。

Windows 安装包若未使用代码签名证书，可能出现 SmartScreen 提示。发布步骤见 [UPDATING.md](UPDATING.md)。

## 本地开发

```sh
npm ci
npm run dev
```

应用入口分别为 `index.html` 和 `widget.html`。运行 `node --test src/schedule.test.js electron/updater.test.cjs` 可执行计算与更新流程测试。
