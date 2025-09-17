
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

import {
  Card,
  Image,
  Text,
  Group,
  ActionIcon,
  Tooltip,
  CopyButton,
  Modal,
  Center,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import {
  IconMail,
  IconBrandWhatsapp,
  IconBrandFacebook,
  IconBrandTelegram,
  IconCopy,
  IconCheck,
  IconQrcode,
} from '@tabler/icons-react';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

type ImageShareProps = {
  imageUrl: string;
  title?: string;
};

export default function ImageShare({ imageUrl, title = 'Check this out!' }: ImageShareProps) {
  const encodedImageUrl = encodeURIComponent(imageUrl);
  const encodedTitle = encodeURIComponent(title);
  const [opened, { open, close }] = useDisclosure(false);
  const [qrCodeDataURL, setQrCodeDataURL] = useState<string>('');

  useEffect(() => {
    QRCode.toDataURL(imageUrl, { width: 256 })
      .then(url => {
        setQrCodeDataURL(url);
      })
      .catch(err => console.error('Error generating QR code:', err));
  }, [imageUrl]);

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

        <Tooltip label="QR Code">
          <ActionIcon onClick={open} color="indigo">
            <IconQrcode size={20} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Modal opened={opened} onClose={close} title="QR Code" centered>
        <Center>
          {qrCodeDataURL ? (
            <img
              src={qrCodeDataURL}
              alt="QR Code for sharing"
              width={256}
              height={256}
              style={{ display: 'block' }}
            />
          ) : (
            <Text>Generating QR code...</Text>
          )}
        </Center>
        <Text ta="center" mt="md" size="sm" c="dimmed">
          Scan this QR code to open the image
        </Text>
      </Modal>
    </Card>
  );
}
