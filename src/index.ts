import joplin from 'api';
import { FileSystemItem, ModelType } from 'api/types';
const fs = joplin.require('fs-extra');

joplin.plugins.register({
	onStart: async function() {
		// eslint-disable-next-line no-console
		console.info('Typora-like Editor Plugin started!');

		await joplin.interop.registerExportModule({
			format: 'typora_md',
			description: 'Markdown (No Title From metadata)',
			target: FileSystemItem.File,
			isNoteArchive: false,
			fileExtensions: ['md'],

			onInit: async function(context: any) {
				context.userData = {
					content: '',
				};
			},

			onProcessItem: async function(context: any, itemType: number, item: any) {
				if (itemType === ModelType.Note) {
					// 获取笔记的完整内容（包括标题）
					const note = await joplin.data.get(['notes', item.id], { fields: ['id', 'title', 'body'] });

					// 只导出笔记内容，不包含标题
					const content = note.body || '';

					// 将内容添加到 userData 中
					context.userData.content += content + '\n\n';
				}
			},

			onProcessResource: async function() {
				// 不处理资源
			},

			onClose: async function(context: any) {
				// 将内容写入导出文件
				await fs.writeFile(context.destPath, context.userData.content, 'utf8');
			},
		});
	},
});
