
import React, { useState } from 'react';
import { Button, ActionIcon, ScrollArea, Card, Text, Group, Paper, Modal, Divider, Stack, Container} from '@mantine/core';

import Configuration from './configuration';
import { IconX, IconPencil} from '@tabler/icons-react';

import {CategoriesType, ProductSpecification} from '../interface'
import sha256 from 'crypto-js/sha256';


interface CartProps {
    products: Record<string, ProductSpecification>;
    setProducts: (products: Record<string, ProductSpecification>) => void;
}


function Cart({products, setProducts}: CartProps) {
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

    const handleEdit = (conf: ProductSpecification) => {
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
              {Object.entries(products[id].specification).map(([subKey, subValue]) => (
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
      <Paper shadow="sm" p="lg" radius="md" withBorder h={{base: "fit", md: "60vh"}}  w="inherit" mih="10vh" mah="90vh">
        <ScrollArea h={{base: "fit", md: "60vh"}} type="always">
          {rows}
        </ScrollArea>        
      </Paper>
    );
  };
  

  export default Cart;