sync:
	npm run dist
	rsync -avP ../joplin-plugin-typora-like-editor /mnt/hgfs/vmdirs/iflow/
