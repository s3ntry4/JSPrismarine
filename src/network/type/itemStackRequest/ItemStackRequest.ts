class ItemStackRequest {
    public id!: number;
    public actions: any[] = [];
    constructor({ id, actions }: { id: number; actions: any[] }) {
        this.id = id;
        this.actions = actions;
    }
}

export default ItemStackRequest;
