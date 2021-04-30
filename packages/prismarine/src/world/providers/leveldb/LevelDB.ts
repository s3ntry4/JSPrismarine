import BaseProvider from '../BaseProvider';
import BinaryStream from '@jsprismarine/jsbinaryutils';
import Chunk from '../../chunk/Chunk';
import Generator from '../../Generator';
import Level from 'leveldb-mcpe';
import Levelup from 'levelup';
import type Server from '../../../Server';
import path from 'path';

/**
 * LevelDB provider,
 * currently not compatible with worlds created in bedrock edition.
 */
export default class LevelDB extends BaseProvider {
    private storage: any;

    public constructor(folderPath: string, server: Server) {
        super(folderPath, server);

        try {
            this.storage = Levelup(new Level(path.join(this.getPath(), 'db')));
        } catch (error) {
            this.getServer().getLogger()?.debug(error.stack, 'providers/LevelDB');
            throw new Error(`failed to open world for reading with id ${this.getPath()}`);
        }
    }

    public async onEnable() {}

    public async onDisable() {
        return new Promise<void>(async (resolve) => {
            await (this as any).storage?.DB?.close?.();

            // Sometimes the database doesn't close even if we await it...
            // don't look at me. idk?
            const inter = setInterval(async () => {
                if ((this.storage as any)?.DB?._db?.status === 'open') {
                    await (this as any).storage?.DB?.close?.();
                    return;
                }

                clearInterval(inter);
                resolve();
            }, 100);
        });
    }

    public async readChunk(cx: number, cz: number, seed: number, generator: Generator, config?: any): Promise<Chunk> {
        try {
            const version = Number(await this.storage.get(Buffer.from(`${LevelDB.chunkIndex(cx, cz)}v`)));

            switch (version) {
                case 7:
                    this.getServer()
                        .getLogger()
                        ?.error(
                            `Please use an older build of JSPrismarine for v(${version}) chunks.`,
                            'providers/LevelDB/readChunk'
                        );
                    await this.getServer().kill({ withoutSaving: true, crash: true });
                    break;
                case 8:
                    break;
                default:
                    throw new Error(`version of chunk is either too new or too old (${version})`);
            }

            const buffer = Buffer.from(await this.storage.get(Buffer.from(LevelDB.chunkIndex(cx, cz))));
            const chunk = Chunk.networkDeserialize(new BinaryStream(buffer));
            (chunk as any).x = cx;
            (chunk as any).z = cz;
            return chunk;
        } catch (error) {
            if (!error.notFound) throw error;

            return generator.generateChunk(cx, cz, seed, config);
        }
    }

    public async writeChunk(chunk: Chunk): Promise<void> {
        const index = LevelDB.chunkIndex(chunk.getX(), chunk.getZ());
        await this.storage.put(Buffer.from(`${index}v`), Buffer.from('8'));
        await this.storage.put(Buffer.from(index), chunk.networkSerialize(true));
    }

    /**
     * Creates an string index from chunk
     * x and z, used to identify chunks
     * in the db.
     */
    public static chunkIndex(chunkX: number, chunkZ: number): string {
        const stream = new BinaryStream();
        stream.writeLInt(chunkX);
        stream.writeLInt(chunkZ);
        return stream.getBuffer().toString('hex');
    }
}
