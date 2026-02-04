all:
	npm run dist
	mkdir -p /mnt/hgfs/vmdirs/iflow/joplin-plugin-typora-like-editor/dist \
	&& rsync -avP dist/ /mnt/hgfs/vmdirs/iflow/joplin-plugin-typora-like-editor/dist/

test-tools:
	npx ts-node src/tools.ts
