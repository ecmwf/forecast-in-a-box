import {
  Card,
  Image,
  Text,
  Group,
  ActionIcon,
  Tooltip,
  CopyButton,
} from '@mantine/core';

import {
  IconMail,
  IconBrandWhatsapp,
  IconBrandFacebook,
  IconBrandTelegram,
  IconCopy,
  IconCheck,
} from '@tabler/icons-react';

type ImageShareProps = {
  imageUrl: string;
  title?: string;
};

export default function ImageShare({ imageUrl, title = 'Check this out!' }: ImageShareProps) {
  const encodedImageUrl = encodeURIComponent(imageUrl);
  const encodedTitle = encodeURIComponent(title);

  console.log('Image URL:', imageUrl);

  const shareLinks = {
    email: `mailto:?subject=${encodedTitle}&body=${encodedTitle}%0A${encodedImageUrl}`,
    whatsapp: `https://wa.me/?text=${encodedTitle}%0A${encodedImageUrl}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedImageUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedImageUrl}`,
    telegram: `https://t.me/share/url?url=${encodedImageUrl}&text=${encodedTitle}`,
  };

  return (
    <Card radius="md" style={{ maxWidth: 400 }}>
      {/* <Card.Section>
        <Image src={imageUrl} alt="Shared content" height={200} fit="cover" />
      </Card.Section> */}

      <Text mt="md" fw={500}>
        Share this image
      </Text>

      <Group mt="sm" p="xs">
        <Tooltip label="Email">
          <ActionIcon component="a" href={shareLinks.email} target="_blank" color="blue">
            <IconMail size={20} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="WhatsApp">
          <ActionIcon component="a" href={shareLinks.whatsapp} target="_blank" color="green">
            <IconBrandWhatsapp size={20} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Facebook">
          <ActionIcon component="a" href={shareLinks.facebook} target="_blank" color="blue">
            <IconBrandFacebook size={20} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Telegram">
          <ActionIcon component="a" href={shareLinks.telegram} target="_blank" color="blue">
            <IconBrandTelegram size={20} />
          </ActionIcon>
        </Tooltip>

        <CopyButton value={imageUrl} timeout={2000}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? 'Copied' : 'Copy link'}>
              <ActionIcon onClick={copy} color={copied ? 'teal' : 'gray'}>
                {copied ? <IconCheck size={20} /> : <IconCopy size={20} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
    </Card>
  );
}
