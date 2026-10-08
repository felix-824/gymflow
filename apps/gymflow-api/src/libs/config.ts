import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { LikeGroup } from './enums/like.enum';

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
import * as path from 'path';

export const validMimeTypes = ['image/png', 'image/jpg', 'image/jpeg'];
export const getSerialForImage = (filename: string) => {
	const ext = path.parse(filename).ext;
	return uuidv4() + ext;
};

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

export const lookupMember = {
	$lookup: {
		from: 'members',
		localField: 'memberId',
		foreignField: '_id',
		as: 'memberData',
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
	},
};

// Favorite program egasining (member)
// ma'lumotlarini members collectiondan olib keladi.
