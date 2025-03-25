
import React, { useState } from 'react';
import { Button, ActionIcon, ScrollArea, Card, Text, Group, Modal, Divider, Stack} from '@mantine/core';

import Configuration from './configuration';
import { IconX, IconPencil} from '@tabler/icons-react';

import {CategoriesType, ProductConfiguration} from './interface'
import sha256 from 'crypto-js/sha256';


interface CartProps {
    products: Record<string, ProductConfiguration>;
    setProducts: (products: Record<string, ProductConfiguration>) => void;
}


const Cart: React.FC<CartProps> = ({products, setProducts}) => {

    const handleRemove = (id: string) => {
      const updatedProducts = { ...products };
      delete updatedProducts[id];
      setProducts(updatedProducts);
    };

    const [modalOpen, setModalOpen] = useState<boolean>(false);
    const [selectedProduct, setSelectedProduct] = useState<string>("");
    
    const openModal = (id: string) => {
      setSelectedProduct(id);
      setModalOpen(true);
    };

    const handleEdit = (conf: ProductConfiguration) => {
        setModalOpen(false);
        handleRemove(selectedProduct);

        setProducts({
          ...products,
          [sha256(JSON.stringify(conf)).toString()]: conf,
      });
      };
  
    const rows = Object.keys(products).map((id) => (
        <>
        <Card padding='xs' shadow='xs' radius='md' key={id}>
            <Card.Section w='100%'>
                <Group justify='space-between' mt="xs" mb="xs">
                    <Text size='md'>{products[id].product}</Text>
                    <Group>
                    {/* <ActionIcon color="green" onClick={() => openModal(id)} size="lg"><IconPencil/></ActionIcon> */}
                    <ActionIcon color="red" onClick={() => handleRemove(id)} size="lg"><IconX/></ActionIcon>
                    </Group>
                </Group>
            </Card.Section>
            {/* <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Edit">
                {selectedProduct !== null && (
                    <Configuration selectedProduct={products[selectedProduct].product} submitTarget={handleEdit}  /> //initial={products[selectedProduct]}
                )}
            </Modal> */}
            <Stack maw='90%' p='' m='' gap='xs'>
              {Object.entries(products[id].options).map(([subKey, subValue]) => (
                subKey !== 'product' && (
                  <Text size='xs' p='' m='' key={subKey} lineClamp={1}>{subKey}: {JSON.stringify(subValue)}</Text>
                )
              ))}
            </Stack>
      </Card>
       <Divider my="md" />
       </>
    ));
    
    return (
      <Card shadow="sm" padding="lg" radius="md" withBorder h="60vh" w="25vw" mih="200px" maw="400px">
        <ScrollArea h='inherit' type="always">
          {rows}
        </ScrollArea>        
      </Card>
    );
  };
  

  export default Cart;