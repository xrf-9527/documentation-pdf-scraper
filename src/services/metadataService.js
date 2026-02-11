// src/services/metadataService.js
export class MetadataService {
  constructor(fileService, pathService, logger) {
    this.fileService = fileService;
    this.pathService = pathService;
    this.logger = logger;
  }

  /**
   * 保存文章标题
   */
  async saveArticleTitle(index, title) {
    const filePath = this.pathService.getMetadataPath('articleTitles');
    await this.fileService.updateJson(
      filePath,
      {},
      (titles) => {
        titles[index] = title;
        return titles;
      },
      { recoverInvalidJson: true }
    );
    this.logger.info(`保存文章标题: [${index}] ${title}`);
  }

  /**
   * 获取所有文章标题
   */
  async getArticleTitles() {
    const filePath = this.pathService.getMetadataPath('articleTitles');
    return await this.fileService.readJson(filePath, {});
  }

  /**
   * 保存section结构信息（用于生成分层TOC）
   */
  async saveSectionStructure(structure) {
    const filePath = this.pathService.getMetadataPath('sectionStructure');
    await this.fileService.writeJson(filePath, structure);
    this.logger.debug(`保存section结构: ${structure.sections?.length || 0} sections`);
  }

  /**
   * 获取section结构信息
   */
  async getSectionStructure() {
    const filePath = this.pathService.getMetadataPath('sectionStructure');
    return await this.fileService.readJson(filePath, null);
  }

  /**
   * 记录失败的链接
   */
  async logFailedLink(url, index, error) {
    const filePath = this.pathService.getMetadataPath('failed');
    await this.fileService.appendToJsonArray(filePath, {
      url,
      index,
      error: error.message || String(error),
      timestamp: new Date().toISOString(),
    });
    this.logger.warn(`记录失败链接: ${url}`, { error: error.message });
  }

  /**
   * 获取所有失败的链接
   */
  async getFailedLinks() {
    const filePath = this.pathService.getMetadataPath('failed');
    return await this.fileService.readJson(filePath, []);
  }

  /**
   * 从失败列表中移除链接
   */
  async removeFromFailedLinks(url) {
    const filePath = this.pathService.getMetadataPath('failed');
    await this.fileService.removeFromJsonArray(filePath, (item) => item.url === url);
    this.logger.debug(`从失败列表移除: ${url}`);
  }

  /**
   * 记录图片加载失败
   */
  async logImageLoadFailure(url, index) {
    const filePath = this.pathService.getMetadataPath('imageLoadFailures');
    const failures = await this.fileService.readJson(filePath, []);

    // 检查是否已存在
    const exists = failures.some((f) => f.url === url && f.index === index);
    if (!exists) {
      failures.push({
        url,
        index,
        timestamp: new Date().toISOString(),
      });
      await this.fileService.writeJson(filePath, failures);
      this.logger.warn(`记录图片加载失败: ${url}`);
    }
  }

  /**
   * 获取图片加载失败列表
   */
  async getImageLoadFailures() {
    const filePath = this.pathService.getMetadataPath('imageLoadFailures');
    return await this.fileService.readJson(filePath, []);
  }

  /**
   * 保存URL映射（URL到文件路径的映射）
   */
  async saveUrlMapping(url, pdfPath) {
    const filePath = this.pathService.getMetadataPath('urlMapping');
    const mapping = await this.fileService.readJson(filePath, {});
    mapping[url] = {
      path: pdfPath,
      timestamp: new Date().toISOString(),
    };
    await this.fileService.writeJson(filePath, mapping);
  }

  /**
   * 获取URL映射
   */
  async getUrlMapping() {
    const filePath = this.pathService.getMetadataPath('urlMapping');
    return await this.fileService.readJson(filePath, {});
  }
}
