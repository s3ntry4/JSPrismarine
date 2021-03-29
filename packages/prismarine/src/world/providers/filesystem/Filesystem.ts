import BaseProvider from '../BaseProvider';
import BinaryStream from '@jsprismarine/jsbinaryutils';
import Chunk from '../../chunk/Chunk';
import Generator from '../../Generator';
import type Server from '../../../Server';
import fs from 'fs';
import path from 'path';

/**
 * Format
 *
 * byte - version
 * int - chunk data size
 * data - chunk data
 * int - entities data size
 * data - entities data
 */
export default class Filesystem extends BaseProvider {
    public constructor(folderPath: string, server: Server) {
        super(folderPath, server);

        if (!fs.existsSync(path.join(this.getPath(), 'chunks'))) fs.mkdirSync(path.join(this.getPath(), 'chunks'));
    }

    public async close() {}

    public async readChunk(cx: number, cz: number, seed: number, generator: Generator, config?: any): Promise<Chunk> {
        try {
            const buffer = new BinaryStream(
                Buffer.from(await fs.promises.readFile(path.join(this.getPath(), 'chunks', `${cx}_${cz}.dat`)))
            );

            const version = buffer.readByte();
            if (version !== 1) throw new Error(`Invalid chunk version "${version}"`);

            const chunkSize = buffer.readInt();
            const chunkData = buffer.read(chunkSize);
            const entitiesSize = buffer.readInt();
            const entitiesData = buffer.read(entitiesSize);

            // TODO: parse entities

            const chunk = Chunk.networkDeserialize(new BinaryStream(chunkData));
            (chunk as any).x = cx;
            (chunk as any).z = cz;
            return chunk;
        } catch {
            return generator.generateChunk(cx, cz, seed, config);
        }
    }

    public async writeChunk(chunk: Chunk): Promise<void> {
        const data = chunk.networkSerialize(true);

        const buf = new BinaryStream();
        buf.writeByte(1); // format version
        buf.writeInt(data.length); // chunk data size
        buf.append(data); // chunk data
        buf.writeInt(0); // entities data size
        // TODO: entities

        await fs.promises.writeFile(
            path.join(this.getPath(), 'chunks', `${chunk.getX()}_${chunk.getZ()}.dat`),
            buf.getBuffer()
        );
    }
}
