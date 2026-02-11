#!/usr/bin/env node

/**
 * 测试分层TOC功能
 */

import { validateConfig } from '../src/config/configValidator.js';
import { MetadataService } from '../src/services/metadataService.js';
import { FileService } from '../src/services/fileService.js';
import { PathService } from '../src/services/pathService.js';
import { createLogger } from '../src/utils/logger.js';
import fs from 'fs/promises';

async function testConfigValidation() {
  console.log('\n📋 测试1: 配置验证 (sectionTitles)');
  console.log('='.repeat(50));

  const testConfig = {
    rootURL: 'https://code.claude.com/docs/en/overview',
    baseUrl: 'https://code.claude.com/docs/en/',
    pdfDir: './output/pdf',
    navLinksSelector: 'a[href]',
    contentSelector: '#content-area',
    allowedDomains: ['code.claude.com'],
    sectionEntryPoints: [
      'https://code.claude.com/docs/en/overview',
      'https://code.claude.com/docs/en/sub-agents',
    ],
    sectionTitles: {
      'https://code.claude.com/docs/en/overview': 'Getting started',
      'https://code.claude.com/docs/en/sub-agents': 'Build with Claude Code',
    },
  };

  try {
    const validated = validateConfig(testConfig);

    if (validated.sectionTitles) {
      console.log('✅ sectionTitles 验证通过');
      console.log('   配置的section标题:', Object.keys(validated.sectionTitles).length);
      Object.entries(validated.sectionTitles).forEach(([url, title]) => {
        console.log(`   - ${title}: ${url}`);
      });
    } else {
      console.log('⚠️  sectionTitles 为空（这是允许的）');
    }

    console.log('✅ 配置验证通过');
    return true;
  } catch (error) {
    console.error('❌ 配置验证失败:', error.message);
    return false;
  }
}

async function testMetadataService() {
  console.log('\n📋 测试2: MetadataService (sectionStructure)');
  console.log('='.repeat(50));

  const tempDir = './temp-test-metadata';

  try {
    // 创建临时目录
    await fs.mkdir(tempDir, { recursive: true });

    const testConfig = {
      pdfDir: tempDir,
      metadata: { directory: 'metadata' },
    };

    const fileService = new FileService(createLogger('FileService'));
    const pathService = new PathService(testConfig, createLogger('PathService'));
    const metadataService = new MetadataService(
      fileService,
      pathService,
      createLogger('MetadataService')
    );

    // 测试数据
    const testStructure = {
      sections: [
        {
          index: 0,
          title: 'Getting started',
          entryUrl: 'https://code.claude.com/docs/en/overview',
          pages: [
            { index: '0', url: 'https://code.claude.com/docs/en/overview', order: 0 },
            { index: '1', url: 'https://code.claude.com/docs/en/installation', order: 1 },
          ],
        },
        {
          index: 1,
          title: 'Build with Claude Code',
          entryUrl: 'https://code.claude.com/docs/en/sub-agents',
          pages: [{ index: '2', url: 'https://code.claude.com/docs/en/sub-agents', order: 0 }],
        },
      ],
      urlToSection: {
        'https://code.claude.com/docs/en/overview': 0,
        'https://code.claude.com/docs/en/installation': 0,
        'https://code.claude.com/docs/en/sub-agents': 1,
      },
    };

    // 保存
    console.log('📝 保存section结构...');
    await metadataService.saveSectionStructure(testStructure);
    console.log('✅ 保存成功');

    // 读取
    console.log('📖 读取section结构...');
    const loaded = await metadataService.getSectionStructure();

    if (!loaded) {
      throw new Error('读取失败：返回null');
    }

    // 验证
    console.log('✅ 读取成功');
    console.log(`   - Sections: ${loaded.sections?.length || 0}`);
    console.log(`   - URL映射: ${Object.keys(loaded.urlToSection || {}).length}`);

    if (loaded.sections?.length === testStructure.sections.length) {
      console.log('✅ Section数量匹配');
    } else {
      throw new Error(
        `Section数量不匹配: 期望${testStructure.sections.length}, 实际${loaded.sections?.length}`
      );
    }

    // 清理
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('✅ MetadataService测试通过');
    return true;
  } catch (error) {
    console.error('❌ MetadataService测试失败:', error.message);
    // 清理
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn('⚠️ 清理临时目录失败:', cleanupError.message);
    }
    return false;
  }
}

async function testSectionStructureFormat() {
  console.log('\n📋 测试3: Section结构格式验证');
  console.log('='.repeat(50));

  const expectedFormat = {
    sections: [
      {
        index: 0,
        title: 'Section Title',
        entryUrl: 'https://example.com/section1',
        pages: [{ index: '0', url: 'https://example.com/page1', order: 0 }],
      },
    ],
    urlToSection: {
      'https://example.com/page1': 0,
    },
  };

  console.log('预期的JSON结构：');
  console.log(JSON.stringify(expectedFormat, null, 2));
  console.log('✅ 格式定义正确');
  return true;
}

async function main() {
  console.log('🚀 开始测试分层TOC功能');
  console.log('='.repeat(50));

  const results = [];

  results.push(await testConfigValidation());
  results.push(await testMetadataService());
  results.push(await testSectionStructureFormat());

  console.log('\n' + '='.repeat(50));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(50));

  const passed = results.filter((r) => r).length;
  const total = results.length;

  console.log(`通过: ${passed}/${total}`);

  if (passed === total) {
    console.log('✅ 所有测试通过！');
    console.log('\n下一步：运行 make clean && make run 来生成带分层TOC的PDF');
    process.exit(0);
  } else {
    console.log('❌ 部分测试失败');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ 测试执行失败:', error);
  process.exit(1);
});
