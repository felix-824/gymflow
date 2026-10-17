import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { LikeGroup } from './enums/like.enum';
import type { OwnerMember, PublicMember } from './dto/member/member';

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const availableTrainerSorts = ['createdAt', 'updatedAt', 'memberLikes', 'memberViews', 'memberRank'];
export const availableMemberSorts = ['createdAt', 'updatedAt', 'memberLikes', 'memberViews'];

export const availableProgramSorts = [
	'createdAt',
	'updatedAt',
	'programLikes',
	'programViews',
	'programRank',
	'programPrice',
	'programDuration',
	'programCapacity',
];

export const availableBoardArticleSorts = ['createdAt', 'updatedAt', 'articleLikes', 'articleViews'];

export const availableCommentSorts = ['createdAt', 'updatedAt'];

// IMAGE CONFIGURATION
import { v4 as uuidv4 } from 'uuid';

export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_UPLOAD_MAX_PIXELS = 16000000;
export const PROGRAM_MAX_IMAGES = 5;
export const validMimeTypes = ['image/png', 'image/jpg', 'image/jpeg', 'image/webp'];
export const getSerialForImage = (format: 'jpeg' | 'png' | 'webp') =>
	uuidv4() + (format === 'jpeg' ? '.jpg' : '.' + format);

export const shapeIntoMongoObjectId = (target: unknown): Types.ObjectId => {
	if (target instanceof Types.ObjectId) return target;
	if (typeof target === 'string' && /^[a-fA-F0-9]{24}$/.test(target)) return new Types.ObjectId(target);
	throw new BadRequestException('Invalid identifier');
};

// Login qilgan member ushbu targetga like bosgan yoki bosmaganini tekshiradi.
export const lookupAuthMemberLiked = (
	memberId: Types.ObjectId | null,
	targetRefId: string = '$_id',
	group: LikeGroup = LikeGroup.MEMBER,
) => {
	return {
		$lookup: {
			from: 'likes',
			let: {
				localLikeRefId: targetRefId,
				localMemberId: memberId,
				localMyFavorite: true,
			},
			pipeline: [
				{
					$match: {
						$expr: {
							$and:
								//likes collectiondagi likeRefId hozirgi trainerning IDsi bilan tengmi?
								[
									{ $eq: ['$likeRefId', '$$localLikeRefId'] },
									{ $eq: ['$likeGroup', group] },
									//likes ichidagi memberId login qilgan Farruxning IDsi bilan tengmi?
									{ $eq: ['$memberId', '$$localMemberId'] },
								],
						},
					},
				},
				{
					$project: {
						_id: 0,
						memberId: 1,
						likeRefId: 1,
						myFavorite: '$$localMyFavorite',
					},
				},
			],
			as: 'meLiked',
		},
	};
};

// Login qilgan member boshqa memberni follow qilgan yoki qilmaganini tekshiradi.
interface LookupAuthMemberFollowed {
	followerId: Types.ObjectId | null;
	followingId: string;
}

export const lookupAuthMemberFollowed = (input: LookupAuthMemberFollowed) => {
	const { followerId, followingId } = input;

	return {
		$lookup: {
			from: 'follows',
			let: {
				localFollowerId: followerId,
				localFollowingId: followingId,
				localMyFavorite: true,
			},
			pipeline: [
				{
					$match: {
						$expr: {
							$and: [{ $eq: ['$followerId', '$$localFollowerId'] }, { $eq: ['$followingId', '$$localFollowingId'] }],
						},
					},
				},
				{
					$project: {
						_id: 0,
						followerId: 1,
						followingId: 1,
						myFollowing: '$$localMyFavorite',
					},
				},
			],
			as: 'meFollowed',
		},
	};
};

export const publicMemberProjection = {
	_id: 1,
	memberType: 1,
	memberNick: 1,
	memberFullName: 1,
	memberImage: 1,
	memberDesc: 1,
	memberPrograms: 1,
	memberArticles: 1,
	memberFollowers: 1,
	memberFollowings: 1,
	memberLikes: 1,
	memberViews: 1,
	memberComments: 1,
	memberRank: 1,
	meLiked: 1,
	meFollowed: 1,
} as const;

export const ownerMemberProjection = {
	...publicMemberProjection,
	memberStatus: 1,
	memberAuthType: 1,
	memberPhone: 1,
	memberAddress: 1,
	memberPoints: 1,
	createdAt: 1,
	updatedAt: 1,
} as const;

export const adminMemberProjection = {
	...ownerMemberProjection,
	memberWarnings: 1,
	memberBlocks: 1,
	deletedAt: 1,
} as const;

// Explicit response allowlists also strip fields from Mongoose authentication results.
export const publicMemberData = (member: PublicMember): PublicMember => ({
	_id: member._id,
	memberType: member.memberType,
	memberNick: member.memberNick,
	memberFullName: member.memberFullName,
	memberImage: member.memberImage,
	memberDesc: member.memberDesc,
	memberPrograms: member.memberPrograms,
	memberArticles: member.memberArticles,
	memberFollowers: member.memberFollowers,
	memberFollowings: member.memberFollowings,
	memberLikes: member.memberLikes,
	memberViews: member.memberViews,
	memberComments: member.memberComments,
	memberRank: member.memberRank,
	meLiked: member.meLiked,
	meFollowed: member.meFollowed,
});

export const ownerMemberData = (member: OwnerMember): OwnerMember => ({
	...publicMemberData(member),
	memberStatus: member.memberStatus,
	memberAuthType: member.memberAuthType,
	memberPhone: member.memberPhone,
	memberAddress: member.memberAddress,
	memberPoints: member.memberPoints,
	createdAt: member.createdAt,
	updatedAt: member.updatedAt,
	accessToken: member.accessToken,
});

export const lookupMember = {
	$lookup: {
		from: 'members',
		localField: 'memberId',
		foreignField: '_id',
		as: 'memberData',
		pipeline: [{ $project: publicMemberProjection }],
	},
};

// Following member ma'lumotlarini members collectiondan olib
//  followingData'ga qo'shadi
export const lookupFollowingData = {
	$lookup: {
		from: 'members',
		localField: 'followingId',
		foreignField: '_id',
		as: 'followingData',
		pipeline: [{ $project: publicMemberProjection }],
	},
};

// Follower member ma'lumotlarini members collectiondan olib
// followerData'ga qo'shadi
export const lookupFollowerData = {
	$lookup: {
		from: 'members',
		localField: 'followerId',
		foreignField: '_id',
		as: 'followerData',
		pipeline: [{ $project: publicMemberProjection }],
	},
};

// Favorite program egasining (member)
// ma'lumotlarini members collectiondan olib keladi.
