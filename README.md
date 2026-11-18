# 页间 · 在线翻页阅读器

一个面向 GitHub Pages 的静态翻页阅读器，附带六页原创示例手册《潮汐之间》。示例封面为 AI 生成的海岸图像。

- 桌面显示封面和双页跨页，手机显示单页。可用按钮、键盘方向键或手机左右滑动翻页。
- 点目录跳页，也可以输入页码并按回车。
- 点「打开 PDF」选取文件，桌面浏览器也可以将 PDF 拖进阅读区。文件只在当前浏览器中解析，关闭或刷新后重新选择即可。
- 有书签的 PDF 使用原书签作为目录，其余 PDF 提供页码索引。此 Demo 的单文件上限为 150 MB。

## 本地预览

在项目目录运行以下命令，然后访问 [http://127.0.0.1:8000](http://127.0.0.1:8000)。

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

直接双击 `index.html` 可以浏览示例手册。打开本地 PDF 需要通过网页地址访问阅读器，以便浏览器加载 PDF 渲染模块和 Worker。

## GitHub Pages 部署

1. 将本目录中的文件推送到仓库的 `main` 分支根目录，包含 `.nojekyll`。
2. 在 GitHub 仓库打开 **Settings → Pages**。
3. 将 **Source** 设为 **Deploy from a branch**，选择 **main** 和 **/ (root)**，保存。
4. 部署成功后，在同一页面查看网站地址。

该项目使用相对资源路径，可直接发布到 GitHub Pages 的项目子路径。无需构建或配置服务器。

## 第三方组件

PDF 使用 [Mozilla PDF.js 6.5.438](https://github.com/mozilla/pdf.js/releases/tag/v6.5.438) 渲染。运行文件和许可证位于 `vendor/pdfjs/`，浏览器从同一站点加载组件。
