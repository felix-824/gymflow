import { BadRequestException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
type ObjectId = Types.ObjectId;
import { Member, Members, OwnerMember, PublicMember, PublicMembers } from '../../libs/dto/member/member';
import { TrainersInquiry, LoginInput, MemberInput, MembersInquiry } from '../../libs/dto/member/member.input';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { AuthService } from '../auth/auth.service';
import { MemberSelfUpdate, MemberUpdate } from '../../libs/dto/member/member.update';
import { StatisticModifier, T } from '../../libs/types/common';
import { ViewService } from '../view/view.service';
import { ViewGroup } from '../../libs/enums/view.enum';
import { LikeInput } from '../../libs/dto/like/like.input';
import { LikeGroup } from '../../libs/enums/like.enum';
import { LikeService } from '../like/like.service';
import { Follower, Following, MeFollowed } from '../../libs/dto/follow/follow';
import {
	adminMemberProjection,
	lookupAuthMemberFollowed,
	lookupAuthMemberLiked,
	ownerMemberData,
	ownerMemberProjection,
	publicMemberData,
	publicMemberProjection,
} from '../../libs/config';

@Injectable()
export class MemberService {
	constructor(
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Follow') private readonly followModel: Model<Follower | Following>,
		private authService: AuthService,
		private viewService: ViewService,
		private likeService: LikeService,
	) {}

	public async signup(input: MemberInput): Promise<OwnerMember> {
		if (input.memberType != null && ![MemberType.USER, MemberType.TRAINER].includes(input.memberType))
			throw new BadRequestException('Invalid signup role');
		input.memberType ??= MemberType.USER;
		input.memberPassword = await this.authService.hashPassword(input.memberPassword);
		try {
			const result = await this.memberModel.create(input);
			return ownerMemberData(result);
		} catch {
			throw new BadRequestException(Message.USED_MEMBER_NICK_OR_PHONE);
		}
	}

	public async login(input: LoginInput): Promise<OwnerMember> {
		const { memberNick } = input;

		const response = await this.memberModel.findOne({ memberNick: memberNick }).select('+memberPassword').exec();

		if (!response || response.memberStatus === MemberStatus.DELETE) {
			throw new InternalServerErrorException(Message.NO_MEMBER_NICK);
		} else if (response.memberStatus === MemberStatus.BLOCK) {
			throw new InternalServerErrorException(Message.BLOCKED_USER);
		}

		//TODO Compare passwords

		const isMatch = await this.authService.comparePasswords(input.memberPassword, response.memberPassword!);
		if (!isMatch) throw new InternalServerErrorException(Message.WRONG_PASSWORD);

		return ownerMemberData(response);
	}

	public async updateMember(memberId: ObjectId, input: MemberSelfUpdate): Promise<OwnerMember> {
		const allowed = [
			'memberPhone',
			'memberNick',
			'memberPassword',
			'memberFullName',
			'memberImage',
			'memberAddress',
			'memberDesc',
		];
		const safe: MemberSelfUpdate = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key)));
		if (safe.memberPassword) safe.memberPassword = await this.authService.hashPassword(safe.memberPassword);
		const result = await this.memberModel //Member
			.findOneAndUpdate(
				{
					_id: memberId,
					memberStatus: MemberStatus.ACTIVE,
				},
				safe,
				{ new: true, runValidators: true },
			)
			.exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		if (safe.memberPassword) await this.authService.revokeMemberSessions(memberId);
		return ownerMemberData(result);
	}

	public async getMyMember(memberId: ObjectId): Promise<OwnerMember> {
		const member = await this.memberModel
			.findOne({ _id: memberId, memberStatus: MemberStatus.ACTIVE })
			.select(ownerMemberProjection)
			.lean()
			.exec();
		if (!member) throw new UnauthorizedException('Please sign in with an active account');
		return ownerMemberData(member);
	}

	public async getPublicMember(memberId: ObjectId | null, targetId: ObjectId): Promise<PublicMember> {
		const member = await this.getMember(memberId, targetId);
		if (member.memberStatus !== MemberStatus.ACTIVE) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return publicMemberData(member);
	}

	public async getMember(memberId: ObjectId | null, targetId: ObjectId): Promise<Member> {
		const search: T = {
			_id: targetId,
			memberStatus: {
				$in: [MemberStatus.ACTIVE, MemberStatus.BLOCK],
			},
		};
		const targetMember: Member | null = await this.memberModel.findOne(search).lean().exec();
		if (!targetMember) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		if (memberId) {
			// record view
			const viewInput = { memberId: memberId, viewRefId: targetId, viewGroup: ViewGroup.MEMBER };
			const newView = await this.viewService.recordView(viewInput);
			if (newView) {
				// increase memberView
				await this.memberModel.findOneAndUpdate(search, { $inc: { memberViews: 1 } }, { new: true }).exec();
				targetMember.memberViews++;
			}

			//meLiked
			const likeInput = { memberId: memberId, likeRefId: targetId, likeGroup: LikeGroup.MEMBER };
			targetMember.meLiked = await this.likeService.checkLikeExistence(likeInput);
			//meFollowed
			targetMember.meFollowed = await this.checkSubscription(memberId, targetId);
		}

		return targetMember;
	}

	// Login member target memberni follow qilgan-qilmaganini tekshiradi
	private async checkSubscription(followerId: ObjectId, followingId: ObjectId): Promise<MeFollowed[]> {
		const result = await this.followModel.findOne({ followingId: followingId, followerId: followerId }).exec();

		return result ? [{ followerId: followerId, followingId: followingId, myFollowing: true }] : [];
	}

	public async getTrainers(memberId: ObjectId, input: TrainersInquiry): Promise<PublicMembers> {
		const { text } = input.search;
		const match: T = { memberType: MemberType.TRAINER, memberStatus: MemberStatus.ACTIVE };
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (text) match.memberNick = { $regex: new RegExp(text, 'i') };
		console.log('match:', match);

		const result = await this.memberModel
			.aggregate<PublicMembers>([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							{ $project: publicMemberProjection },
							lookupAuthMemberLiked(memberId),
							lookupAuthMemberFollowed({ followerId: memberId, followingId: '$_id' }),
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	// Login memberning target memberga
	// LIKE/UNLIKE bosishini boshqaradi
	public async likeTargetMember(memberId: ObjectId, likeRefId: ObjectId): Promise<PublicMember> {
		const target = await this.memberModel.findOne({ _id: likeRefId, memberStatus: MemberStatus.ACTIVE }).exec();
		if (!target) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		const input: LikeInput = {
			memberId: memberId,
			likeRefId: likeRefId,
			likeGroup: LikeGroup.MEMBER,
		};

		// LIKE TOGGLE via Like modules
		const modifier: number = await this.likeService.toggleLike(input);
		const result = await this.memberStatsEditor({ _id: likeRefId, targetKey: 'memberLikes', modifier: modifier });

		if (!result) throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
		return publicMemberData(result);
	}

	public async getAllMembersByAdmin(input: MembersInquiry): Promise<Members> {
		const { memberStatus, memberType, text } = input.search;
		const match: T = {};
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (memberStatus) match.memberStatus = memberStatus;
		if (memberType) match.memberType = memberType;

		if (text) match.memberNick = { $regax: new RegExp(text, 'i') };
		console.log('match:', match);

		const result = await this.memberModel
			.aggregate<Members>([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							{ $project: adminMemberProjection },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	public async updateMemberByAdmin(input: MemberUpdate): Promise<Member> {
		if (input.memberType !== undefined && !Object.values(MemberType).includes(input.memberType))
			throw new BadRequestException('Invalid role');
		if (input.memberStatus !== undefined && !Object.values(MemberStatus).includes(input.memberStatus))
			throw new BadRequestException('Invalid status');
		if (input.memberPassword) input.memberPassword = await this.authService.hashPassword(input.memberPassword);
		const result = await this.memberModel
			.findOneAndUpdate({ _id: input._id }, input, { new: true, runValidators: true })
			.select(adminMemberProjection)
			.exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
		if (input.memberPassword || input.memberStatus === MemberStatus.BLOCK || input.memberStatus === MemberStatus.DELETE)
			await this.authService.revokeMemberSessions(input._id);

		return result;
	}

	public async memberStatsEditor(input: StatisticModifier): Promise<Member> {
		const { _id, targetKey, modifier } = input;

		const result = await this.memberModel
			.findByIdAndUpdate(
				_id,
				{
					$inc: { [targetKey]: modifier },
				},
				{ new: true },
			)
			.exec();

		if (!result) {
			throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		}
		return result;
	}
}
