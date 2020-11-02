// first we import a few needed things again
import {
	PuppetBridge,
	IRemoteUser,
	IReceiveParams,
	IRemoteRoom,
	IMessageEvent,
	IFileEvent,
	MessageDeduplicator,
	Log,
} from "mx-puppet-bridge";

import { VK, MessageContext, Context } from "vk-io";
import { userInfo } from "os";
import { runInThisContext } from "vm";

// here we create our log instance
const log = new Log("VKPuppet:vk");

// this interface is to hold all data on a single puppet
interface IEchoPuppet {
	// this is usually a client class that connects to the remote protocol
	// as we just echo back, unneeded in our case
	client: VK;
	data: any; // and let's keep a copy of the data associated with a puppet
}

// we can hold multiple puppets at once...
interface IEchoPuppets {
	[puppetId: number]: IEchoPuppet;
}

export class VkPuppet {
	private puppets: IEchoPuppets = {};
	constructor(
		private puppet: PuppetBridge,
	) { }

	public async getSendParams(puppetId: number, peerId: number, senderId: number): Promise<IReceiveParams> {
		// we will use this function internally to create the send parameters
		// needed to send a message, a file, reactions, ... to matrix
		log.info(`Creating send params for ${peerId}...`);

		return {
			room: await this.getRemoteRoom(puppetId, peerId),
			user: await this.getRemoteUser(puppetId, senderId),
		};
	}

	public async getRemoteUser(puppetId: number, userId: number): Promise<IRemoteUser> {
		const p = this.puppets[puppetId];
		log.info("User id:", userId, userId.toString());
		if (userId < 0) {
			const info = await p.client.api.groups.getById({ group_id: Math.abs(userId).toString() });
			const response: IRemoteUser = {
				puppetId,
				userId: userId.toString(),
				name: info[0].name,
				avatarUrl: info[0].photo_200,
			};
			return response;
		} else {
			const info = await p.client.api.users.get({ user_ids: userId.toString(), fields: ["photo_max"] });
			const response: IRemoteUser = {
				puppetId,
				userId: userId.toString(),
				name: `${info[0].first_name} ${info[0].last_name}`,
				avatarUrl: info[0].photo_max,
			};
			return response;
		}
	}

	public async getRemoteRoom(puppetId: number, peerId: number): Promise<IRemoteRoom> {
		const p = this.puppets[puppetId];
		const info = await p.client.api.messages.getConversationsById({ peer_ids: peerId, fields: ["photo_max"] });
		log.info(info.items[0]);
		let response: IRemoteRoom;
		switch (info.items[0].peer.type) {
			case "user":
				const userInfo = await p.client.api.users.get({ user_ids: info.items[0].peer.id, fields: ["photo_max"] });
				response = {
					puppetId,
					roomId: peerId.toString(),
					name: `${userInfo[0].first_name} ${userInfo[0].last_name}`,
					avatarUrl: userInfo[0].photo_max,
					isDirect: true,
				};
				break;

			case "chat":
				response = {
					puppetId,
					roomId: peerId.toString(),
					name: info.items[0].chat_settings.title,
					avatarUrl: info.items[0].chat_settings.photo.photo_200,
				};
				break;

			default:
				response = {
					puppetId,
					roomId: peerId.toString(),
					name: peerId.toString(),
					// avatarUrl: info.items['chat_settings']['photo_200'],
				};
				break;
		}
		return response;
	}

	public async newPuppet(puppetId: number, data: any) {
		// this is called when we need to create a new puppet
		// the puppetId is the ID associated with that puppet and the data its data
		if (this.puppets[puppetId]) {
			// the puppet somehow already exists, delete it first
			await this.deletePuppet(puppetId);
		}
		// usually we create a client class of some sorts to the remote protocol
		// and listen to incoming messages from it
		const client = new VK({ token: data.token, apiLimit: 20 });
		log.info("Trying to init listener with", data.token);

		client.updates.on("message", async (context) => {
			try {
				log.info("Recieved something!");
				await this.handleVkMessage(puppetId, context);
			} catch (err) {
				log.error("Error handling vk message event", err.error || err.body || err);
			}
		});
		client.updates.on("message_typing_state", async (context) => {
			if (context.isUser) {
				const params = await this.getSendParams(puppetId, context.fromId, context.fromId);
				await this.puppet.setUserTyping(params, context.isTyping);
			} else {
				const params = await this.getSendParams(puppetId, 2000000000 + (context?.chatId ?? 0), context.fromId);
				await this.puppet.setUserTyping(params, context.isTyping);
			}
		});
		data.id = Number((await client.api.groups.getById({}))[0].id) * -1;
		this.puppets[puppetId] = {
			client,
			data,
		};
		await client.updates.start();
	}

	public async deletePuppet(puppetId: number) {
		// this is called when we need to delte a puppet
		const p = this.puppets[puppetId];
		if (!p) {
			// puppet doesn't exist, nothing to do
			return;
		}
		await p.client.updates.stop();
		delete this.puppets[puppetId]; // and finally delete our local copy
	}

	public async handleMatrixMessage(room: IRemoteRoom, data: IMessageEvent, event: any) {
		// this is called every time we receive a message from matrix and need to
		// forward it to the remote protocol.

		// first we check if the puppet exists
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		// usually you'd send it here to the remote protocol via the client object
		const dedupeKey = `${room.puppetId};${room.roomId}`;
		try {
			const response = await p.client.api.messages.send({
				peer_id: Number(room.roomId),
				message: data.body,
				random_id: new Date().getTime(),
			});
		} catch (err) {
			log.error("Error sending to vk", err.error || err.body || err);
		}

	}

	public async createRoom(room: IRemoteRoom): Promise<IRemoteRoom | null> {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return null;
		}
		log.info(`Received create request for channel update puppetId=${room.puppetId} roomId=${room.roomId}`);

		return await this.getRemoteRoom(room.puppetId, Number(room.roomId));
	}

	public async getDmRoomId(user: IRemoteUser): Promise<string | null> {
		// this is called whenever someone invites a ghost on the matrix side
		// from the user ID we need to return the room ID of the DM room, or null if none is present

		// first we check if the puppet exists
		const p = this.puppets[user.puppetId];
		if (!p) {
			return null;
		}

		// now we just return the userId of the ghost
		return user.userId;
	}

	public async handleVkMessage(puppetId: number, context: MessageContext) {
		const p = this.puppets[puppetId];
		if (!p) {
			return;
		}
		log.info("Received new message!", context);

		const params = await this.getSendParams(puppetId, context.peerId, context.senderId);

		if (context.hasText && !context.isOutbox) {
			const opts = {
				body: context.text || "Attachment",
			};
			await this.puppet.sendMessage(params, opts);
		}
	}
}
