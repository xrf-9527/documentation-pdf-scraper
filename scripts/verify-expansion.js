#!/usr/bin/env node

/**
 * 验证 PDF 中是否包含折叠内容
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const TARGET_URL = 'https://platform.openai.com/docs/guides/prompt-engineering';

async function verifyExpansion() {
  let browser = null;

  try {
    console.log('\n🔍 验证折叠内容是否被展开\n');

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log('⏳ 加载页面...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('✅ 页面加载完成\n');

    // 查找折叠内容的标题和内容
    const collapsibleInfo = await page.evaluate(() => {
      const results = [];

      // 查找所有 aria-expanded 元素
      document.querySelectorAll('[aria-expanded]').forEach((trigger) => {
        const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
        const title = trigger.textContent.trim();

        // 查找关联的内容
        let contentPreview = '';
        const nextSibling = trigger.nextElementSibling;
        if (nextSibling) {
          contentPreview = nextSibling.textContent.trim().substring(0, 100);
        }

        results.push({
          title,
          expanded: isExpanded,
          contentPreview,
        });
      });

      return results;
    });

    console.log('📋 找到的折叠元素:\n');
    collapsibleInfo.forEach((item, index) => {
      console.log(`${index + 1}. "${item.title}"`);
      console.log(`   - 状态: ${item.expanded ? '✅ 展开' : '❌ 折叠'}`);
      if (item.contentPreview) {
        console.log(`   - 内容预览: ${item.contentPreview.substring(0, 60)}...`);
      }
      console.log('');
    });

    // 现在执行展开并提取完整内容
    const expandedContent = await page.evaluate(() => {
      const targetItems = [];

      // 展开所有折叠元素
      document.querySelectorAll('[aria-expanded="false"]').forEach((trigger) => {
        trigger.setAttribute('aria-expanded', 'true');

        const title = trigger.textContent.trim();
        const nextSibling = trigger.nextElementSibling;

        if (nextSibling) {
          nextSibling.classList.remove('hidden', 'collapsed');
          nextSibling.style.setProperty('display', 'block', 'important');
          nextSibling.style.setProperty('visibility', 'visible', 'important');

          const content = nextSibling.textContent.trim();
          if (content.length > 50) {
            targetItems.push({
              title,
              contentLength: content.length,
              contentSample: content.substring(0, 200),
            });
          }
        }
      });

      return targetItems;
    });

    console.log('✅ 展开后的内容统计:\n');
    expandedContent.forEach((item, index) => {
      console.log(`${index + 1}. "${item.title}"`);
      console.log(`   - 内容长度: ${item.contentLength} 字符`);
      console.log(`   - 内容示例:\n     ${item.contentSample.split('\n')[0].substring(0, 80)}...`);
      console.log('');
    });

    const totalContent = expandedContent.reduce((sum, item) => sum + item.contentLength, 0);
    console.log(
      `📊 总计: ${expandedContent.length} 个折叠项，共 ${totalContent.toLocaleString()} 字符的隐藏内容\n`
    );
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

verifyExpansion().catch(console.error);
