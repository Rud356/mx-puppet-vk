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
	ISendingUser,
} from "mx-puppet-bridge";

import { VK, MessageContext, Context, AttachmentType } from "vk-io";
import { userInfo } from "os";
import { runInThisContext } from "vm";
import { lookup } from "dns";

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

	public async getSendParams(puppetId: number, peerId: number, senderId: number, eventId?: string | undefined):
		Promise<IReceiveParams> {
		// we will use this function internally to create the send parameters
		// needed to send a message, a file, reactions, ... to matrix
		//log.info(`Creating send params for ${peerId}...`);

		return {
			room: await this.getRemoteRoom(puppetId, peerId),
			user: await this.getRemoteUser(puppetId, senderId),
			eventId,
		};
	}

	public async getRemoteUser(puppetId: number, userId: number): Promise<IRemoteUser> {
		const p = this.puppets[puppetId];
		//log.info("User id:", userId, userId.toString());
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
		//log.info(info.items[0]);
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

		client.updates.on("message_new", async (context) => {
			try {
				log.info("Recieved something!");
				await this.handleVkMessage(puppetId, context);
			} catch (err) {
				log.error("Error handling vk message event", err.error || err.body || err);
			}
		});
		client.updates.on("message_edit", async (context) => {
			try {
				log.info("Edit recieved!");
				await this.handleVkEdit(puppetId, context);
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

	//////////////////////////
	// Matrix -> VK section //
	//////////////////////////

	public async handleMatrixMessage(room: IRemoteRoom, data: IMessageEvent, event: any) {
		// this is called every time we receive a message from matrix and need to
		// forward it to the remote protocol.

		// first we check if the puppet exists
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		// usually you'd send it here to the remote protocol via the client object
		try {
			const response = await p.client.api.messages.send({
				peer_id: Number(room.roomId),
				message: data.body,
				random_id: new Date().getTime(),
			});
			await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
		} catch (err) {
			log.error("Error sending to vk", err.error || err.body || err);
		}
	}

	public async handleMatrixEdit(room: IRemoteRoom, eventId: string, data: IMessageEvent) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		// usually you'd send it here to the remote protocol via the client object
		try {
			const response = await p.client.api.messages.edit({
				peer_id: Number(room.roomId),
				message: data.body,
				message_id: Number(eventId),
				random_id: new Date().getTime(),
			});
			await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
		} catch (err) {
			log.error("Error sending edit to vk", err.error || err.body || err);
		}
	}


	public async handleMatrixReply(
		room: IRemoteRoom,
		eventId: string,
		data: IMessageEvent,
		event: any,
	) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		try {
			//log.info("Sending reply", Number(eventId));
			const response = await p.client.api.messages.send({
				peer_id: Number(room.roomId),
				message: await this.stripReply(data.body),
				random_id: new Date().getTime(),
				reply_to: Number(eventId),
			});
			await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
		} catch (err) {
			log.error("Error sending to vk", err.error || err.body || err);
		}
	}

	public async handleMatrixImage(
		room: IRemoteRoom,
		data: IFileEvent,
		asUser: ISendingUser | null,
		event: any,
	) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		const MAXFILESIZE = 50000000;
		const size = data.info ? data.info.size || 0 : 0;

		if (size < MAXFILESIZE) {
			try {
				//log.info("Sending image...");
				const attachment = await p.client.upload.messagePhoto({
					peer_id: Number(room.roomId),
					source: {
						value: data.url,
					},
				});
				//log.info("Image sent", attachment);
				const response = await p.client.api.messages.send({
					peer_id: Number(room.roomId),
					random_id: new Date().getTime(),
					attachment: [`photo${attachment.ownerId}_${attachment.id}`],
				});
				await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
			} catch (err) {
				log.error("Error sending to vk", err.error || err.body || err);
			}
		} else {
			try {
				const response = await p.client.api.messages.send({
					peer_id: Number(room.roomId),
					message: `File ${data.filename} was sent, but it is too big for VK. You may download it there:\n${data.url}`,
					random_id: new Date().getTime(),
				});
				await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
			} catch (err) {
				log.error("Error sending to vk", err.error || err.body || err);
			}
		}
	}

	public async handleMatrixFile(
		room: IRemoteRoom,
		data: IFileEvent,
		asUser: ISendingUser | null,
		event: any,
	) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		const MAXFILESIZE = 50000000;
		const size = data.info ? data.info.size || 0 : 0;

		if (size < MAXFILESIZE) {
			try {
				//log.info("Sending file...");
				const attachment = await p.client.upload.messageDocument({
					peer_id: Number(room.roomId),
					source: {
						value: data.url,
						filename: data.filename,
					},
				});
				//log.info("File sent", attachment);
				const response = await p.client.api.messages.send({
					peer_id: Number(room.roomId),
					random_id: new Date().getTime(),
					attachment: [`doc${attachment.ownerId}_${attachment.id}`],
				});
				await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
			} catch (err) {
				try {
					const response = await p.client.api.messages.send({
						peer_id: Number(room.roomId),
						message: `File ${data.filename} was sent, but VK refused to recieve it. You may download it there:\n${data.url}`,
						random_id: new Date().getTime(),
					});
					await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
				} catch (err) {
					log.error("Error sending to vk", err.error || err.body || err);
				}
			}
		} else {
			try {
				const response = await p.client.api.messages.send({
					peer_id: Number(room.roomId),
					message: `File ${data.filename} was sent, but it is too big for VK. You may download it there:\n${data.url}`,
					random_id: new Date().getTime(),
				});
				await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
			} catch (err) {
				log.error("Error sending to vk", err.error || err.body || err);
			}
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

	//////////////////////////
	// VK -> Matrix section //
	//////////////////////////

	public async handleVkMessage(puppetId: number, context: MessageContext) {
		const p = this.puppets[puppetId];
		if (!p) {
			return;
		}
		//log.info("Received new message!", context);
		if (context.isOutbox) {
			return; // Deduping
		}

		const params = await this.getSendParams(puppetId, context.peerId, context.senderId, context.id.toString());

		if (context.hasText) {
			if (context.hasReplyMessage) {
				if (this.puppet.eventSync.getMatrix(params.room, context.replyMessage!.id.toString())) {
					const opts: IMessageEvent = {
						body: context.text || "Attachment",
					};
					// We got referenced message in room, using matrix reply
					await this.puppet.sendReply(params, context.replyMessage!.id.toString(), opts);
				} else {
					// Using a fallback
					const opts: IMessageEvent = {
						body: await this.prependReply(
							puppetId, context.text || "",
							context.replyMessage?.text || "",
							context.senderId.toString(),
						),
					};
					await this.puppet.sendMessage(params, opts);
				}
			} else {
				const opts: IMessageEvent = {
					body: context.text || "Attachment",
				};
				await this.puppet.sendMessage(params, opts);
			}
		}
		if (context.hasAttachments()) {
			for (const f of context.attachments) {
				switch (f.type) {
					case AttachmentType.PHOTO:
						try {
							// tslint:disable-next-line: no-string-literal
							await this.puppet.sendFileDetect(params, f["largeSizeUrl"]);
						} catch (err) {
							const opts: IMessageEvent = {
								body: `Image was sent: ${f["largeSizeUrl"]}`,
							};
							await this.puppet.sendMessage(params, opts);
						}
						break;
					case AttachmentType.STICKER:
						try {
							await this.puppet.sendFileDetect(params, f["imagesWithBackground"][4]["url"]);
						} catch (err) {
							const opts: IMessageEvent = {
								body: `Sticker was sent: ${f["imagesWithBackground"][4]["url"]}`,
							};
							await this.puppet.sendMessage(params, opts);
						}
						break;
					case AttachmentType.AUDIO_MESSAGE:
						try {
							await this.puppet.sendAudio(params, f["oggUrl"]);
						} catch (err) {
							const opts: IMessageEvent = {
								body: `Audio message was sent: ${f["url"]}`,
							};
							await this.puppet.sendMessage(params, opts);
						}
						break;
					default:
						break;
				}
			}
		}
	}


	public async handleVkEdit(puppetId: number, context: MessageContext) {
		log.error("OwO", context);
		const p = this.puppets[puppetId];
		if (!p) {
			return;
		}
		// As VK always sends edit as outbox, we won't work with any edits from groups
		if (context.senderType == "group") {
			log.error("oh no no");

			return; // Deduping
		}

		const params = await this.getSendParams(puppetId, context.peerId, context.senderId, context.id.toString());
		log.error("UWU", context.hasText);
		if (context.hasText) {
				const opts: IMessageEvent = {
					body: context.text || "Attachment",
				};
				await this.puppet.sendEdit(params, context.id.toString(), opts);
		}
	}

	////////////////
	// Formatters //
	////////////////

	public async prependReply(puppetId: number, body: string, reply: string, userid: string) {
		const user = await this.getRemoteUser(puppetId, Number(userid));
		const replySplitted = reply.split("\n");
		let formatted: string = `> <${user.name}>\n`;
		replySplitted.forEach((element) => {
			formatted += `> ${element}`;
		});
		formatted += `\n\n${body}`;
		return formatted;
	}

	public async stripReply(body: string) {
		let splitted = body.split("\n");
		let isCitate = true;
		while (isCitate) {
			if (splitted[0].startsWith(">")) {
				splitted.splice(0, 1);
			} else {
				isCitate = false;
			}
		}
		return(splitted.join('\n').trim());
	}
}
