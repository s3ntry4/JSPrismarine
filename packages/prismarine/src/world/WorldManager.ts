import Anvil from './providers/anvil/Anvil';
import GeneratorManager from './GeneratorManager';
import LevelDB from './providers/leveldb/LevelDB';
import Provider from './providers/Provider';
import Server from '../Server';
import World from './World';
import fs from 'fs';

interface WorldData {
    seed: number;
    provider: string;
    generator: string;
}

export default class WorldManager {
    private readonly worlds: Map<string, World> = new Map();
    private defaultWorld!: World;
    private readonly genManager: GeneratorManager;
    private readonly server: Server;
    private providers: Map<string, any> = new Map(); // TODO: this should be a manager

    public constructor(server: Server) {
        this.server = server;
        this.genManager = new GeneratorManager(server);

        // Create folders
        if (!fs.existsSync(process.cwd() + '/worlds')) {
            fs.mkdirSync(process.cwd() + '/worlds');
        }
    }

    public async onEnable(): Promise<void> {
        this.addProvider('LevelDB', LevelDB);
        this.addProvider('Anvil', Anvil);

        const defaultWorld = this.server.getConfig().getLevelName();
        if (!defaultWorld) {
            this.server.getLogger().warn(`Invalid world!`, 'WorldManager/onEnable');
            return;
        }

        const world = await this.loadWorld(this.server.getConfig().getWorlds()[defaultWorld], defaultWorld);
        await world.onEnable();
    }

    public async onDisable(): Promise<void> {
        await Promise.all(this.getWorlds().map(async (world) => this.unloadWorld(world.getName())));
        this.providers.clear();
    }

    /**
     * Add a provider to the internal providers map
     *
     * @param name the name of the provider CASE SENSITIVE
     * @param provider the provider
     */
    public addProvider(name: string, provider: any) {
        this.providers.set(name, provider);
    }

    /**
     * Remove a provider from the internal providers map
     *
     * @param name the name of the provider CASE SENSITIVE
     */
    public removeProvider(name: string) {
        this.providers.delete(name);
    }

    /**
     * Get all providers
     */
    public getProviders(): Map<string, Provider> {
        return this.providers;
    }

    public async save(): Promise<void> {
        this.server.getLogger().info('Saving worlds', 'WorldManager/save');
        for (const world of this.getWorlds()) {
            await world.save();
            await world.close();
        }
    }

    /**
     * Load a world
     *
     * @param worldData the world data including provider key, generator
     * @param folderName the name of the folder containing the world
     */
    public async loadWorld(worldData: WorldData, folderName: string): Promise<World> {
        return new Promise((resolve, reject) => {
            if (this.isWorldLoaded(folderName)) {
                this.server
                    .getLogger()
                    .warn(`World §e${folderName}§r has already been loaded!`, 'WorldManager/loadWorld');
                reject();
            }

            const levelPath = process.cwd() + `/worlds/${folderName}/`;
            const provider = this.providers.get(worldData.provider ?? 'LevelDB');
            const generator = this.server
                .getWorldManager()
                .getGeneratorManager()
                .getGenerator(worldData.generator ?? 'overworld');

            if (!provider) {
                reject(new Error(`invalid provider with id ${worldData.provider}`));
                return;
            }

            if (!generator) {
                reject(new Error(`invalid generator with id ${worldData.generator}`));
                return;
            }

            // TODO: figure out provider by data
            const world = new World({
                name: folderName,
                server: this.server,
                provider: new provider(levelPath, this.server),

                seed: worldData.seed,
                generator
            });
            this.worlds.set(world.getUniqueId(), world);

            // First level to be loaded is also the default one
            if (!this.defaultWorld) {
                this.defaultWorld = this.worlds.get(world.getUniqueId())!;
                this.server.getLogger().info(`Loaded §b${folderName}§r as default world!`, 'WorldManager/loadWorld');
            }

            this.server.getLogger().debug(`World §b${folderName}§r successfully loaded!`, 'WorldManager/loadWorld');
            resolve(world);
        });
    }

    /**
     * Unloads a level by its folder name.
     */
    public async unloadWorld(folderName: string): Promise<void> {
        if (!this.isWorldLoaded(folderName)) {
            this.server
                .getLogger()
                .error(`Cannot unload a not loaded world with name §b${folderName}`, 'WorldManager/unloadWorld');
            return;
        }

        const world = this.getWorldByName(folderName);
        if (!world) {
            this.server.getLogger().error(`Cannot unload world ${folderName}`, 'WorldManager/unloadWorld');
            return;
        }

        await world.close();
        this.worlds.delete(world.getUniqueId());
        this.server.getLogger().debug(`Successfully unloaded world §b${folderName}§f!`, 'WorldManager/unloadWorld');
    }

    /**
     * Returns whatever the world is loaded or not.
     */
    public isWorldLoaded(folderName: string): boolean {
        for (const world of this.worlds.values()) {
            if (world.getName().toLowerCase() === folderName.toLowerCase()) {
                return true;
            }

            if (world.getUniqueId() === folderName) {
                return true;
            }
        }

        return false;
    }

    /**
     * Returns a world by its folder name.
     */
    public getWorldByName(folderName: string): World | null {
        return this.getWorlds().find((world) => world.getName().toLowerCase() === folderName.toLowerCase()) ?? null;
    }

    /**
     * Returns an array with all worlds.
     */
    public getWorlds(): World[] {
        return Array.from(this.worlds.values());
    }

    public getDefaultWorld(): World {
        return this.defaultWorld;
    }

    public getGeneratorManager(): GeneratorManager {
        return this.genManager;
    }
}