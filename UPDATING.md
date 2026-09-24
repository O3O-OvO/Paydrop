# Windows 自动更新发布

项目使用公开 GitHub Releases 发布 NSIS 安装包。现有便携版不会自动升级；用户需要先安装 `1.1.1` 或更高版本，后续安装版才能收到更新。薪资和作息设置保存在 Electron 的 `userData` 目录，不随安装包替换。

## 首次发布

1. 远端已绑定到公开仓库 `O3O-OvO/Paydrop`。上传前请检查公开素材，并确认不要提交 `node_modules/`、`dist/`、`release/` 或密钥（参见 `.gitignore`）。
2. `v1.1.0` 的首次 CI 构建失败，未产生可安装的 Release。将修复代码推送到 `main`，并创建与 `package.json` 一致的新标签：

   ```sh
   git add .
   git commit -m "Add Windows auto updates"
   git push -u origin main
   git tag v1.1.1
   git push origin v1.1.1
   ```

   `.github/workflows/publish-windows.yml` 会在 Windows runner 上构建安装包，并把 `.exe` 和 `latest.yml` 发布到该仓库的 Releases。推送标签前也可以在 GitHub Actions 页面手动运行该工作流做一次不发布的试构建。
3. 从 Releases 安装首版 `Paydrop-Setup-1.1.1-x64.exe`。原便携版用户需要手动运行此安装包一次；不要用便携版测试自动更新。

## 后续更新

先更新代码并运行 `npm version 1.1.2 --no-git-tag-version`，提交 `package.json`、`package-lock.json` 和代码，然后创建并推送 `v1.1.2` 标签。标签必须与包版本一致；未发布的新版本不会被客户端发现。真实验收应从已安装的 `1.1.1` 检查并下载 `1.1.2`，再通过挂件上的重启按钮完成安装。也可以退出应用让下载好的更新自动安装。

本机可设置 `GITHUB_REPOSITORY=OWNER/REPO`，再运行 `npm run pack:win` 制作不上传的安装包。只有 GitHub Actions 的带标签构建会使用 `--publish always`。旧版便携包的本地构建命令保留为 `npm run pack:portable`。

## 签名与安全

建议正式分发前配置 Windows 代码签名证书，并把 PFX 文件的 Base64 内容与密码分别保存为仓库 Actions secrets `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`。没有证书时安装包可能触发 Windows SmartScreen 提醒；不要为绕过签名问题关闭更新包的签名校验。发布工作流需要 `contents: write` 才能创建 Release。
